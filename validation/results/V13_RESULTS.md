# V13 Results: Input Guard, Rate Limiter, and Injection Neutralization

**Evaluation Run Timestamp**: 2026-10-15T17:29:19.442Z
**Corpus Git Tag**: `v13-corpus-v1` (972 total frozen items)
**Driver / Runtime**: Node v24.13.1 on win32 (x64)

## 1. Executive Summary & Production Invariant Verification

| Evaluation Domain | Evaluated Dimension | Target Specification | Observed Outcome | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Input Guard (Direct Injection)** | Public & Adaptive Jailbreaks | Detection recall per category | Stratified in Table 1 | **DOCUMENTED** |
| **Input Guard (Benign Queries)** | 13 Trigger Word Classes | False-positive rate per class | Stratified in Table 2 | **DOCUMENTED** |
| **Oversize Boundary** | Length Threshold | Exact at 4,000 UTF-16 units | Cutoff: 4000 vs 4001 units | **STRICT PASS** |
| **Rate Limiter (Quota & Window)** | 30 req / 60s window | 30 allowed, 31st denied (429) | Allowed: **30/30**, 31st: **429** | **STRICT PASS** |
| **Rate Limiter (Key Isolation)** | Cross-User Independence | User 2 not throttled by User 1 | User 2 request passed (200) | **STRICT PASS** |
| **Rate Limiter (Concurrency)** | 100 Parallel Requests | No race overruns | **30 passed, 70 throttled** | **STRICT PASS** |
| **Indirect Neutralization** | Document Chunk Sanitization | Neutralize instruction canaries | Stratified in Table 4 | **DOCUMENTED** |
| **Benign Chunk Integrity** | Clean Document Retention | 0 false neutralizations | **0 / 200 altered** (0.0%) | **STRICT PASS** |

## 2. Table 1: Direct Prompt Injection Detection Recall by Category & Provenance

| Injection Category / Variant | Provenance | Total Items ($N$) | Detected ($k$) | Detection Recall | Wilson 95% CI |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `public_deepset_injection` | `public:deepset/prompt-injections:test` | 60 | 0 | **0.0%** | [0.0%, 6.0%] |
| `suite_10_item` | `server/benchmark/suite.js:81` | 10 | 10 | **100.0%** | [72.2%, 100.0%] |
| `adaptive_paraphrase` | `mutation:paraphrase:seed_20262315` | 10 | 3 | **30.0%** | [10.8%, 60.3%] |
| `multilingual_hindi` | `agent-authored:multilingual_hindi` | 4 | 0 | **0.0%** | [0.0%, 49.0%] |
| `multilingual_tamil` | `agent-authored:multilingual_tamil` | 4 | 0 | **0.0%** | [0.0%, 49.0%] |
| `multilingual_german` | `agent-authored:multilingual_german` | 4 | 0 | **0.0%** | [0.0%, 49.0%] |
| `encoding_base64` | `mutation:base64:suite_0` | 10 | 0 | **0.0%** | [0.0%, 27.8%] |
| `obfuscation_leetspeak` | `mutation:leetspeak:suite_0` | 10 | 0 | **0.0%** | [0.0%, 27.8%] |
| `obfuscation_homoglyphs` | `mutation:homoglyphs:suite_0` | 10 | 1 | **10.0%** | [1.8%, 40.4%] |
| `obfuscation_zero_width` | `mutation:zero_width:suite_0` | 10 | 0 | **0.0%** | [0.0%, 27.8%] |
| `wrapper_markdown_html_json` | `mutation:wrapper:suite_0` | 20 | 20 | **100.0%** | [83.9%, 100.0%] |
| `split_across_turns` | `mutation:split_turns:suite_0` | 10 | 10 | **100.0%** | [72.2%, 100.0%] |

## 3. Table 2: Benign Analytical Questions False-Positive Rate by Trigger Word

| Trigger Word / Class | Provenance | Total Queries ($N$) | Falsely Blocked ($k$) | False-Positive Rate | Wilson 95% CI |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `public_deepset_benign` | `public:deepset/prompt-injections:test` | 56 | 0 | **0.0%** | [0.0%, 6.4%] |
| `suite_safe_corpus` | `server/benchmark/suite.js:93` | 4 | 0 | **0.0%** | [0.0%, 49.0%] |
| `trigger_word_reveal` | `agent-authored:trigger_reveal` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_bypass` | `agent-authored:trigger_bypass` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_override` | `agent-authored:trigger_override` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_ignore` | `agent-authored:trigger_ignore` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_admin` | `agent-authored:trigger_admin` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_system` | `agent-authored:trigger_system` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_union` | `agent-authored:trigger_union` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_drop` | `agent-authored:trigger_drop` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_developer` | `agent-authored:trigger_developer` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_instructions` | `agent-authored:trigger_instructions` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_previous` | `agent-authored:trigger_previous` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_forget` | `agent-authored:trigger_forget` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |
| `trigger_word_act as` | `agent-authored:trigger_act as` | 25 | 0 | **0.0%** | [0.0%, 13.3%] |

## 4. Table 3: Oversize Input Boundary & Enforced Length Units

| Character Encoding / Class | Target Length | UTF-16 Code Units | UTF-8 Bytes | Unicode Code Points | Blocked? | Reason Flag |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `oversize_ascii` | 3999 | 3999 | 3999 | 3999 | **NO (Accepted)** | `none` |
| `oversize_ascii` | 4000 | 4000 | 4000 | 4000 | **NO (Accepted)** | `none` |
| `oversize_ascii` | 4001 | 4001 | 4001 | 4001 | **YES (400)** | `oversized_input` |
| `oversize_multibyte_latin_accents` | 3999 | 3999 | 7998 | 3999 | **NO (Accepted)** | `none` |
| `oversize_multibyte_latin_accents` | 4000 | 4000 | 8000 | 4000 | **NO (Accepted)** | `none` |
| `oversize_multibyte_latin_accents` | 4001 | 4001 | 8002 | 4001 | **YES (400)** | `oversized_input` |
| `oversize_multibyte_greek` | 3999 | 3999 | 7998 | 3999 | **NO (Accepted)** | `none` |
| `oversize_multibyte_greek` | 4000 | 4000 | 8000 | 4000 | **NO (Accepted)** | `none` |
| `oversize_multibyte_greek` | 4001 | 4001 | 8002 | 4001 | **YES (400)** | `oversized_input` |
| `oversize_astral_emoji` | 3999 | 3999 | 7997 | 2000 | **NO (Accepted)** | `none` |
| `oversize_astral_emoji` | 4000 | 4000 | 8000 | 2000 | **NO (Accepted)** | `none` |
| `oversize_astral_emoji` | 4001 | 4001 | 8001 | 2001 | **YES (400)** | `oversized_input` |
| `oversize_combining_mark` | 3999 | 3999 | 5998 | 3999 | **NO (Accepted)** | `none` |
| `oversize_combining_mark` | 4000 | 4000 | 6000 | 4000 | **NO (Accepted)** | `none` |
| `oversize_combining_mark` | 4001 | 4001 | 6001 | 4001 | **YES (400)** | `oversized_input` |

**HTTP Body-Size Limit Finding**:
- Request with 9 MB JSON payload: **HTTP 200 (Accepted)**
- Request with 11 MB JSON payload: **HTTP 413 (Payload Too Large / entity.too.large)**
- *Code Fact*: Express JSON body parser is configured with `limit: '10mb'` at `server/src/app.js:28`.

## 5. Rate Limiter Experimental Empirical Findings (C4)

1. **Exact Request Cap**: Tested 31 consecutive requests from a single client. Requests 1 through 30 were allowed (**30/30**). The 31st request was rejected with **HTTP 429 Too Many Requests** and header `Retry-After: 60`.
2. **Window Sliding**: Advancing simulated time by 61 seconds immediately replenished the 30-request quota (Replenished).
3. **Key Derivation (User vs. IP)**: User-authenticated requests derive their key from `req.user.user_id`. Independent users from the same IP address have isolated quotas. Changing client IP headers does not reset an authenticated user's quota.
4. **X-Forwarded-For Spoofing Vulnerability**:
   - **Without `trust proxy`** (default): Express ignores `X-Forwarded-For` and keys requests by the remote socket address (`127.0.0.1`). IP spoofing is ineffective.
   - **With `trust proxy: true`**: Express accepts arbitrary client-supplied `X-Forwarded-For` headers. Unauthenticated clients can rotate header values on every request to obtain unlimited rate limit quotas.
5. **100,000 Key Flood & In-Memory Footprint**:
   - Flooded the rate limiter with 100,000 distinct IP keys within a single 60s window.
   - Memory footprint increased by **+-4.99 MB** heap.
   - *Eviction Defect*: The cleanup routine (`rate.limit.js:19`) only prunes keys where `now - v[v.length - 1] > windowMs`. Within the active 60s window, zero keys are evicted, allowing unbounded map growth during sustained distributed floods.
6. **100 Parallel Requests Concurrency**: When 100 requests arrive concurrently, exactly **30** requests execute and **70** requests receive HTTP 429 without race overruns.
7. **Clock Jump Backwards**: When system time jumps backward by 30 seconds, existing timestamps remain in the sliding window array, temporarily extending throttle duration.
8. **Multi-Worker Process Isolation**: `buckets` is an in-memory `Map` local to a single Node.js process. In multi-process cluster or multi-replica container environments, each worker maintains independent buckets, multiplying effective throughput by worker count.

## 6. Table 4: Indirect Injection Neutralization Recall Across Canary Families (C5)

| Canary Injection Family | Total Items ($N$) | Neutralized ($k$) | Neutralization Recall | Canary Survived in Cleaned Output? |
| :--- | :---: | :---: | :---: | :---: |
| `canary_direct_instruction` | 27 | 0 | **0.0%** | 27 / 27 (100.0%) |
| `canary_role_play` | 27 | 0 | **0.0%** | 27 / 27 (100.0%) |
| `canary_system_inst_delimiters` | 26 | 26 | **100.0%** | 0 / 26 (0.0%) |
| `canary_inst_tag` | 26 | 26 | **100.0%** | 0 / 26 (0.0%) |
| `canary_markdown_html_comments` | 26 | 0 | **0.0%** | 26 / 26 (100.0%) |
| `canary_base64_encoded` | 26 | 0 | **0.0%** | 0 / 26 (0.0%) |
| `canary_unicode_tricks` | 26 | 0 | **0.0%** | 26 / 26 (100.0%) |
| `canary_multilingual` | 26 | 0 | **0.0%** | 26 / 26 (100.0%) |

**Clean Document Chunk Retention**:
- Tested 200 legitimate documentation and reporting chunks through `neutralizeInjection`.
- Altered / False-neutralized chunks: **0 / 200** (0.0% false-neutralization rate).

