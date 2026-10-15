# CogniCore Codebase Dossier — Part 0: Repository Facts

This document establishes the factual foundation of the CogniCore codebase for academic research and rigorous evaluation. Every fact is verified against code receipts or raw command outputs.

---

## 0.1 Repository Metadata & Environment Receipts

Raw command output executed in `C:/cognicore/CogniCore`:
```text
$ git rev-parse HEAD; git log -5 --oneline; node -v; npm -v
6f2dd4c004e555b83587c3e0c195f7882432ad9b
6f2dd4c test(validation): P2 fixture fit-check — 15 DB generatability matrix
5ac452c docs: validation seam & reconciliation report for testing suite
64d14ea Initial commit - CogniCore
v24.13.1
11.8.0
```

- **Commit Hash**: `6f2dd4c004e555b83587c3e0c195f7882432ad9b`
- **Node.js Runtime Version**: `v24.13.1`
- **Package Manager (npm)**: `11.8.0`
- **Operating System**: Windows (NT 10.0.26200)

---

## 0.2 Directory Tree (Depth 3)

Excluding `node_modules`, `.git`, `data`, `data-test`, and `uploads` directories:

```text
C:\cognicore\CogniCore
├── ARCHITECTURE_GAP_ANALYSIS.md
├── CAPABILITIES.md
├── DEPLOYMENT.md
├── docker-compose.yml
├── ENGINEERING_RULES.md
├── FEATURE_TRACKER.md
├── PROGRESS.md
├── README.md
├── START_HERE.md
├── client/
│   ├── .dockerignore
│   ├── .oxlintrc.json
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx.conf
│   ├── package-lock.json
│   ├── package.json
│   ├── README.md
│   ├── vite.config.js
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   └── src/
│       ├── App.css
│       ├── App.jsx
│       ├── index.css
│       ├── main.jsx
│       ├── assets/
│       ├── components/
│       ├── services/
│       └── state/
├── docs/
│   ├── CODEBASE_DOSSIER.md
│   ├── FIXTURE_FIT_CHECK.md
│   ├── validation_seams.json
│   ├── VALIDATION_SEAM_REPORT.md
│   └── dossier/
├── server/
│   ├── .dockerignore
│   ├── .env
│   ├── .env.example
│   ├── Dockerfile
│   ├── package-lock.json
│   ├── package.json
│   ├── benchmark/
│   │   ├── run.js
│   │   └── suite.js
│   ├── scripts/
│   │   └── generate-sample-data.js
│   ├── src/
│   │   ├── app.js
│   │   ├── index.js
│   │   ├── actions/
│   │   ├── agent/
│   │   ├── analytics/
│   │   ├── api/
│   │   ├── config/
│   │   ├── core/
│   │   ├── documents/
│   │   ├── evidence/
│   │   ├── guardrails/
│   │   ├── ingestion/
│   │   ├── knowledge/
│   │   ├── llm/
│   │   ├── memory/
│   │   ├── observability/
│   │   ├── python/
│   │   ├── quality/
│   │   ├── report/
│   │   ├── response/
│   │   ├── schema/
│   │   ├── security/
│   │   ├── semantic/
│   │   ├── structured/
│   │   ├── tools/
│   │   └── utils/
│   └── tests/
│       ├── benchmark/
│       ├── helpers/
│       ├── integration/
│       ├── unit/
│       └── validation/
```

---

## 0.3 Codebase Line Counts by Subsystem

Computed by physical line scanning across files:

| Subsystem Path | Total Files | Total Lines | Breakdown by Extension | Primary Architectural Purpose |
|---|---:|---:|---|---|
| `server/src` | 140 | 10,936 | `.js`: 10,815 lines (139 files)<br>`.py`: 121 lines (1 file) | Core backend: Express REST API, ingestion, query planning, safety gates, LLM orchestration, analytics |
| `client/src` | 32 | 3,799 | `.jsx`: 2,333 lines (17 files)<br>`.css`: 1,198 lines (6 files)<br>`.js`: 205 lines (3 files)<br>Assets: 63 lines (6 files) | Single-page frontend: React 19 UI, conversational workspace, data preview, evidence drawers |
| `server/tests` | 37 | 18,770 | `.js`: 3,640 lines (36 files)<br>`.json`: 15,130 lines (1 file) | Native Node.js test suite (`unit/`, `integration/`, `benchmark/`, `validation/fitcheck/`) |
| `server/benchmark` | 2 | 228 | `.js`: 228 lines (2 files) | Deterministic and LLM accuracy evaluation benchmark runner and 21 ground-truth queries |

---

## 0.4 Backend Dependencies & Technical Roles

Extracted directly from `server/package.json:15-45`:

| Dependency Package | Declared Version | Purpose in CogniCore Architecture |
|---|---|---|
| `axios` | `^1.7.7` | HTTP client for dispatching JSON-RPC requests to the local Ollama server and outbound webhooks |
| `bcryptjs` | `^3.0.3` | Pure JavaScript implementation of bcrypt password hashing algorithm for local authentication |
| `better-sqlite3` | `^12.11.1` | Synchronous, high-performance C++ SQLite binding for registry DB, trace logs, and data query execution |
| `cors` | `^2.8.5` | Express middleware controlling Cross-Origin Resource Sharing headers for client interactions |
| `csv-parse` | `^5.5.6` | Streaming RFC 4180 CSV parser for ingesting delimiter-separated structured spreadsheets |
| `dotenv` | `^16.4.5` | Environment variable loader populating `process.env` from `.env` files |
| `express` | `^4.19.2` | Minimalist web application framework hosting REST endpoints and middleware chains |
| `jsonwebtoken` | `^9.0.3` | Cryptographic signing and verification of stateless HMAC-SHA256 bearer tokens |
| `mammoth` | `^1.12.3` | DOCX document parser extracting unformatted text and tables for document RAG indexing |
| `morgan` | `^1.10.0` | Standardized HTTP request logging middleware |
| `multer` | `^1.4.5-lts.1` | Multipart/form-data handler buffering uploaded data files to local storage |
| `mysql2` | `^3.24.4` | Relational database client adapter connecting to remote MySQL database sources |
| `node-sql-parser` | `^4.18.0` | Lexer and Abstract Syntax Tree (AST) parser validating SQL syntax, dialect safety, and AST node whitelisting |
| `pdfjs-dist` | `^3.11.174` | Mozilla PDF text extraction library processing unstructured PDF documentation |
| `pdfkit` | `^0.20.2` | Declarative programmatic PDF document generation engine compiling downloadable executive reports |
| `pg` | `^8.23.0` | Non-blocking PostgreSQL client adapter querying external PostgreSQL database engines |
| `uuid` | `^9.0.1` | Cryptographically secure RFC 4122 UUID v4 generator for dataset, trace, session, and user identifiers |
| `xlsx` | `^0.18.5` | SheetJS workbook parser materializing Excel `.xlsx`/`.xls` sheets into relational SQLite tables |
| `nodemon` *(dev)* | `^3.1.4` | Process supervisor automatically restarting the Node daemon upon filesystem changes |
| `nodemailer` *(optional)* | `^6.9.14` | SMTP client dispatching automated report emails when user explicitly triggers an email action |

---

## 0.5 Entry Points & npm Lifecycle Scripts

### Server Startup Mechanics
- **Boot Script**: `server/src/index.js:7-18`
- **App Factory**: `server/src/app.js:15-58` builds Express instance, applies CORS, JSON parsing, security headers, request logging, and registers routers (`/api/auth`, `/api/chat`, `/api/datasets`, `/api/policies`, `/api/actions`, `/api/admin`, `/api/reports`).
- **Network Port**: Defaults to TCP port `4000` via `process.env.PORT || '4000'` (`server/src/config/env.js:19`).
- **Warm-Up Phase**: Invokes `warmUpOllama()` on start (`server/src/index.js:33-49`) to pre-load Ollama model weights into GPU VRAM before handling requests.

### npm Lifecycle Scripts
Defined in `server/package.json:7-14`:

| Script Name | Executed Command | Description |
|---|---|---|
| `npm start` | `node src/index.js` | Starts the production Express backend server on port 4000 |
| `npm run dev` | `nodemon src/index.js` | Starts the server under nodemon for live hot-reloading during backend development |
| `npm test` | `node --test` | Executes Node's native built-in test runner across all files matching `server/tests/**/*.test.js` |
| `npm run sample-data` | `node scripts/generate-sample-data.js` | Synthesizes standard evaluation CSVs and `sample-data/retail_multitable.db` |
| `npm run benchmark` | `node benchmark/run.js --mode=tools` | Runs the deterministic benchmark test harness (evaluates tools without requiring Ollama) |
| `npm run benchmark:llm` | `node benchmark/run.js --mode=llm` | Runs the full LLM benchmark suite evaluating model SQL accuracy against 21 pinned queries |
