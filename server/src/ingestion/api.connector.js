/**
 * REST / GraphQL CONNECTOR (Feature 31, "APIs" ingestion)
 * Pulls JSON from an HTTP API, extracts the record array, flattens it and ingests
 * it through the normal pipeline - so the data gets the same schema detection,
 * semantic model, data-quality report, security and analytics as an upload.
 *
 * SSRF protection (fails closed): http(s) only; the host is resolved and every
 * address must be public (no loopback / private / link-local / cloud-metadata);
 * redirects are not followed; response size and time are capped; an optional
 * host allowlist (API_CONNECTOR_ALLOWED_HOSTS) narrows it further. Credentials
 * passed in headers are used for the single fetch and are NEVER stored.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/env');
const { ingestFile } = require('./ingestion.pipeline');

const MAX_BYTES = parseInt(process.env.API_CONNECTOR_MAX_MB || '20', 10) * 1024 * 1024;
const TIMEOUT_MS = 15000;

function parseIPv6ToWords(ip) {
  if (!ip || typeof ip !== 'string') return null;
  let clean = ip.trim().replace(/^\[|\]$/g, '');
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) clean = clean.slice(0, zoneIndex);
  clean = clean.toLowerCase();

  // Check for embedded IPv4 at the end (e.g. ::ffff:192.168.1.1)
  let v4Words = [];
  const lastColon = clean.lastIndexOf(':');
  if (lastColon !== -1) {
    const candidateV4 = clean.slice(lastColon + 1);
    if (net.isIPv4(candidateV4)) {
      const octets = candidateV4.split('.').map(Number);
      v4Words = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
      clean = clean.slice(0, lastColon);
    }
  }

  // Handle :: compression
  const parts = clean.split('::');
  if (parts.length > 2) return null;

  let leftWords = [];
  let rightWords = [];

  if (parts[0]) {
    const rawLeft = parts[0].split(':').filter(Boolean);
    for (const h of rawLeft) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      leftWords.push(parseInt(h, 16));
    }
  }

  if (parts.length === 2 && parts[1]) {
    const rawRight = parts[1].split(':').filter(Boolean);
    for (const h of rawRight) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      rightWords.push(parseInt(h, 16));
    }
  }

  const specifiedCount = leftWords.length + rightWords.length + v4Words.length;
  if (parts.length === 1) {
    if (specifiedCount !== 8) return null;
    return [...leftWords, ...v4Words];
  }

  if (specifiedCount > 7) return null;
  const fillWords = Array(8 - specifiedCount).fill(0);
  return [...leftWords, ...fillWords, ...rightWords, ...v4Words];
}

function isPrivateIpv4(ip) {
  if (!net.isIPv4(ip)) return true;
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
  return false;
}

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  let clean = ip.trim().replace(/^\[|\]$/g, '');
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) clean = clean.slice(0, zoneIndex);

  if (net.isIPv4(clean)) {
    return isPrivateIpv4(clean);
  }

  const words = parseIPv6ToWords(clean);
  if (!words) return true; // Fail closed on unparseable IP

  // ::/128 (unspecified) & ::1/128 (loopback)
  if (words.every(w => w === 0)) return true;
  if (words.slice(0, 7).every(w => w === 0) && words[7] === 1) return true;

  // IPv4-mapped (::ffff:0:0/96) & IPv4-compatible (::0:0/96)
  if ((words.slice(0, 5).every(w => w === 0) && words[5] === 0xffff) || words.slice(0, 6).every(w => w === 0)) {
    const v4 = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
    return isPrivateIpv4(v4);
  }

  // 6to4 (2002::/16)
  if (words[0] === 0x2002) {
    const v4 = [words[1] >> 8, words[1] & 0xff, words[2] >> 8, words[2] & 0xff].join('.');
    if (isPrivateIpv4(v4)) return true;
  }

  // Unique local fc00::/7 (0xfc00 - 0xfdff)
  if ((words[0] & 0xfe00) === 0xfc00) return true;
  // Link-local unicast fe80::/10 (0xfe80 - 0xfebf)
  if ((words[0] & 0xffc0) === 0xfe80) return true;
  // Site-local fec0::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true;
  // Discard prefix 100::/64
  if (words[0] === 0x0100 && words.slice(1, 4).every(w => w === 0)) return true;
  // Documentation 2001:db8::/32
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;
  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
}

async function assertPublicUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { throw new Error('A valid URL is required.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed; use headers instead.');
  const allow = (process.env.API_CONNECTOR_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(u.hostname.toLowerCase())) throw new Error(`Host not allowed. Approved hosts: ${allow.join(', ')}.`);
  if (process.env.API_CONNECTOR_ALLOW_PRIVATE === 'true') {
    u.pinnedIp = u.hostname.replace(/^\[|\]$/g, '');
    return u;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address resolves to a private or internal network, which is blocked.');
  u.pinnedIp = addrs[0].address;
  return u;
}

function requestWithPinnedIp(urlObj, options, pinnedIp) {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: options.method,
      headers: options.headers,
      lookup: (hostname, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
          return cb(null, pinnedIp, net.isIP(pinnedIp));
        }
        if (opts && opts.all) {
          return cb(null, [{ address: pinnedIp, family: net.isIP(pinnedIp) }]);
        }
        return cb(null, pinnedIp, net.isIP(pinnedIp));
      }
    };

    const req = lib.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        return reject(new Error('The API responded with a redirect, which is not followed for safety.'));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`The API responded with HTTP ${res.statusCode}.`));
      }

      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          req.destroy();
          return reject(new Error(`Response exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.`));
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
    });

    req.setTimeout(TIMEOUT_MS);

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function getPath(obj, dotted) {
  return String(dotted).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** First array of objects found (breadth-first, depth-limited) - used when recordsPath is not given. */
function findRecordArray(obj, depth = 0) {
  if (Array.isArray(obj)) return obj.length && obj.every((x) => x && typeof x === 'object' && !Array.isArray(x)) ? obj : null;
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  let best = null;
  for (const v of Object.values(obj)) {
    const found = findRecordArray(v, depth + 1);
    if (found && (!best || found.length > best.length)) best = found;
  }
  return best;
}

function flattenRecord(rec, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(rec)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flattenRecord(v, key, out, depth + 1);
    else out[key] = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v;
  }
  return out;
}

async function fetchRecords({ url, method = 'GET', headers = {}, query = null, body = null, graphql = null, recordsPath = null }) {
  const u = await assertPublicUrl(url);
  const isGql = !!graphql;
  const m = isGql ? 'POST' : String(method).toUpperCase();
  if (!['GET', 'POST'].includes(m)) throw new Error('Only GET and POST are supported.');
  const safeHeaders = { Accept: 'application/json', ...Object.fromEntries(Object.entries(headers || {}).filter(([k]) => !/^(host|content-length|connection|transfer-encoding)$/i.test(k))) };
  if (m === 'POST') safeHeaders['Content-Type'] = 'application/json';
  const postBody = m === 'POST' ? JSON.stringify(isGql ? { query: graphql.query, variables: graphql.variables || {} } : (body || {})) : undefined;

  const text = await requestWithPinnedIp(u, { method: m, headers: safeHeaders, body: postBody }, u.pinnedIp);
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('The API response was not valid JSON.'); }
  if (isGql && json.errors?.length) throw new Error(`GraphQL error: ${json.errors[0].message}`);
  const root = isGql ? json.data : json;
  const records = recordsPath ? getPath(root, recordsPath) : findRecordArray(root);
  if (!Array.isArray(records) || !records.length) throw new Error('No array of records was found in the response. Provide "recordsPath" (e.g. "data.items").');
  if (!records.every((r) => r && typeof r === 'object')) throw new Error('The records are not JSON objects.');
  return records.slice(0, 200000).map((r) => flattenRecord(r));
}

async function ingestApi({ url, name, ownerId = null, ...opts }) {
  const records = await fetchRecords({ url, ...opts });
  fs.mkdirSync(config.paths.uploads, { recursive: true });
  const file = path.join(config.paths.uploads, `${uuidv4()}.json`);
  fs.writeFileSync(file, JSON.stringify(records));
  const safeName = String(name || new URL(url).hostname).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'api_data';
  const dataset = await ingestFile({ filePath: file, originalFilename: `${safeName}.json`, ownerId });
  return { dataset, recordCount: records.length };
}

module.exports = { ingestApi, fetchRecords, assertPublicUrl, requestWithPinnedIp, isPrivateIp, parseIPv6ToWords, findRecordArray, flattenRecord };
