# Baseline Commit Ladder v3

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**Facts Registry Reference:** Cites [F-001](11_FACTS_REGISTRY.md#f-001) through [F-050](11_FACTS_REGISTRY.md#f-050)

---

## 1. Commit Ladder Architecture

Because `git tag -l` is empty in this repository, all milestones and historical baselines are grounded strictly in immutable git object commit hashes.

The security evaluation measures security posture across a verifiable commit ladder:
1. **True Earliest Baseline (`6f2dd4c004e555b83587c3e0c195f7882432ad9b`)**: The `original_head` recorded in `validation/MANIFEST.json` ([F-049](11_FACTS_REGISTRY.md#f-049)), preceding all validation protocols and hardening fixes.
2. **Pre-Driver-Fix Baseline (`903c3c18e4a9f7521c4bbff26eece86fe7244b9f` - Item 4)**: The historical release after Items 1–3 landed, but immediately prior to driver-level storage isolation and worker thread timeouts ([F-045](11_FACTS_REGISTRY.md#f-045)).
3. **First Storage Hardening Milestone (`932996b80337287a2cb89349bf838b6058f94416` - Item 5)**: Verified via `git rev-parse 932996b` ([F-048](11_FACTS_REGISTRY.md#f-048)); introduces `sqlite.worker.js`, `readonly: true`, and `PRAGMA query_only = ON`.
4. **Post-Hardening Production Target (`9cde26cc712cd805d48c2ede925393742ec1b68d` - HEAD)**: The current production release incorporating Items 1 through 12.

---

## 2. Chronological Security Commit Milestones

```
6f2dd4c (True Earliest Baseline: validation/MANIFEST.json original_head)
   |
20a2164 (prereg_commit: validation protocol committed)
   |
8205910 (Item 1: Schema normalization, rejects sqlite_master)
   |
56313f7 (Item 2: AST function blacklist DANGEROUS_FUNCTIONS)
   |
971d171 (Item 3: Universal egress chokepoint sanitizeEgress)
   |
903c3c1 (Item 4: Pre-driver-fix baseline; readonly: false, no worker)
   |
932996b (Item 5: First storage hardening: sqlite.worker.js, readonly: true)
   |
9e8ae7b (Item 6: PII verification, camelCase & Luhn algorithm)
   |
493a6bc (Item 7: Authentication lockout & progressive backoff)
   |
17cce2f (Item 8: Lexer doubled quote & integer division repair)
   |
76c28cf (Item 9: Knowledge base authorization, scope * admin-only)
   |
ef91e9d (Item 10: Webhook SSRF IP pinning requestWithPinnedIp)
   |
c8b008e (Item 11: Ingestion polyglot guard & zip bomb defense)
   |
965ba48 (Item 12: Prompt hygiene & canary token suppression)
   |
9cde26c (HEAD: Master reconciled release & frozen evaluation tree)
```

### Full Commit Hashes Table

| Short Hash | Full Git Object Hash | Focus / Milestone | Verified Git Citation Command |
| :--- | :--- | :--- | :--- |
| `6f2dd4c` | `6f2dd4c004e555b83587c3e0c195f7882432ad9b` | Earliest baseline (original_head) | `git rev-parse 6f2dd4c` |
| `20a2164` | `20a21643d7fc31a3811abc6927b17296b9c8df0e` | Preregistration protocol | `git rev-parse 20a2164` |
| `8205910` | `8205910e76fd6f3438dee71c86304f731e0c5a8c` | Item 1: Policy schema qualification | `git rev-parse 8205910` |
| `56313f7` | `56313f721ce8995a557b4f53c1dbbb4ea863ae37` | Item 2: AST dangerous functions | `git rev-parse 56313f7` |
| `971d171` | `971d171e21b2bb9622d16377f0775d714578b8bc` | Item 3: Universal egress guard | `git rev-parse 971d171` |
| `903c3c1` | `903c3c18e4a9f7521c4bbff26eece86fe7244b9f` | Item 4: Pre-driver-fix baseline | `git rev-parse 903c3c1` |
| `932996b` | `932996b80337287a2cb89349bf838b6058f94416` | Item 5: First storage hardening | `git rev-parse 932996b` |
| `9e8ae7b` | `9e8ae7bdc8df8398e470ee64998d89b1480f2dbe` | Item 6: PII Luhn & camelCase | `git rev-parse 9e8ae7b` |
| `493a6bc` | `493a6bc3f789d3eb475966d54cf8bf37d2f954f9` | Item 7: Auth progressive lockout | `git rev-parse 493a6bc` |
| `17cce2f` | `17cce2f77864f1dc982703f8f17a943feef09bcf` | Item 8: Lexer escaped quotes | `git rev-parse 17cce2f` |
| `76c28cf` | `76c28cf7e52a944208a0d28cb11b933cf8527a81` | Item 9: Knowledge base RBAC | `git rev-parse 76c28cf` |
| `ef91e9d` | `ef91e9d1bf77ea8cbaaa9528d7d96d29ec49b2d8` | Item 10: Webhook SSRF IP pinning | `git rev-parse ef91e9d` |
| `c8b008e` | `c8b008ef38799ea4e14f6b57954b9d0b60ee7416` | Item 11: Polyglot upload guard | `git rev-parse c8b008e` |
| `965ba48` | `965ba48e14670fbe7ba07e5f3964d7c813bebf0f` | Item 12: Prompt canary suppression | `git rev-parse 965ba48` |
| `9cde26c` | `9cde26cc712cd805d48c2ede925393742ec1b68d` | HEAD: Master reconciled release | `git rev-parse HEAD` |

---

## 3. Per-Commit File Layout, Worker Presence & Signatures

Verification executed via `git show <hash>:<path> | grep -n`:

```bash
# Verify worker absence at 903c3c1:
git show 903c3c1:server/src/structured/sqlite.worker.js 2>&1
# Returns: fatal: path 'server/src/structured/sqlite.worker.js' exists on disk, but not in '903c3c1'

# Verify worker presence at 932996b:
git show 932996b:server/src/structured/sqlite.worker.js | grep -n "readonly: true"
# Returns: 8:  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

# Verify connection mode at 903c3c1:
git show 903c3c1:server/src/ingestion/adapters/sqlite.adapter.js | grep -n "readonly:"
# Returns: 10:    this.db = new Database(this.location, { readonly: false, fileMustExist: true });

# Verify connection mode at 932996b:
git show 932996b:server/src/ingestion/adapters/sqlite.adapter.js | grep -n "readonly:"
# Returns: 15:      this.db = new Database(this.location, { readonly: true, fileMustExist: true });
```

### Architectural Layout Across Core Baselines

| Dimension / File | Earliest Baseline (`6f2dd4c`) | Pre-Driver-Fix (`903c3c1`) | First Storage Fix (`932996b`) | Production HEAD (`9cde26c`) |
| :--- | :--- | :--- | :--- | :--- |
| **`sqlite.worker.js`** | **ABSENT** | **ABSENT** | **PRESENT** (`readonly: true`, timeout) | **PRESENT** |
| **`sqlite.adapter.js`** | `readonly: false` | `readonly: false` | `readonly: true`, `query_only=ON` | `readonly: true`, `query_only=ON` |
| **`sql.executor.js`** | Synchronous main thread | Synchronous main thread | Isolated `Worker` with timer | Isolated `Worker` with timer |
| **`data.policy.js`** | No catalog blocking | Catalog blocking active (Item 1) | Catalog blocking active | Catalog blocking active |
| **`egress.guard.js`** | Basic egress | Universal egress (Item 3) | Universal egress | Universal egress |
| **`sql.generator.js`** | Standard prompt | Standard prompt | Standard prompt | Canary suppression (Item 12) |

---

## 4. Suite-to-Commit Run Matrix

To isolate the exact contribution of each architectural layer, suites are scheduled across historical commits:

| Test Suite | Earliest Baseline (`6f2dd4c`) | Pre-Driver-Fix (`903c3c1`) | First Storage Fix (`932996b`) | Post-Fix HEAD (`9cde26c`) | Evaluated Delta |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **S1-A Gates (Destructive DDL/DML)** | YES | YES | YES | YES | Proves driver isolation catches bypasses when validator ablated. |
| **S1-B Prompt-to-SQL (RQ1 Prompts)** | NO | Optional | NO | YES | Evaluates end-to-end prompt injection robustness. |
| **S1-C1 Held-Out Corpus 1** | YES | YES | NO | YES | Unbiased generalization test across hardening ladder. |
| **S1-C2 Held-Out Corpus 2** | NO | NO | NO | YES (Sealed) | Cryptographically sealed post-fix verification. |
| **S1-D Direct Tool Endpoints** | YES | YES | NO | YES | Measures tools vs standalone AST execution parity. |
| **S2-A Tier 1 (Enforcement-Only)** | YES | YES | NO | YES | Evaluates AST rewriting compliance on RCR policies. |
| **S2-A Tier 2 (Natural Language Chat)**| NO | NO | NO | YES | End-to-end access control refusal on local model. |
| **S2-B Row-Level Mutation Suite** | YES | YES | NO | YES | Tests shadow CTE rewrite on bank & child fixtures. |
| **S2-C Utility & Scaling** | NO | NO | NO | YES | Measures performance and accuracy overhead of HEAD. |

---

## 5. Worktree Checkout & Native Build Dependency Invariants

- **Zero Dependency Drift**: `git diff 6f2dd4c 9cde26c -- server/package.json server/package-lock.json` returns zero lines changed. Dependency specifications and pinned versions are 100% identical from `6f2dd4c` through `HEAD`.
- **No Native Rebuild Required**: Because `better-sqlite3` (`12.11.1`) is pinned identically across all commits, checkout worktrees can share the primary workspace's compiled native binaries via symlinking without running `npm ci` or `npm rebuild`:
  ```bash
  git worktree add ../cognicore-baseline-903c3c1 903c3c18e4a9f7521c4bbff26eece86fe7244b9f
  ln -s "$(pwd)/server/node_modules" "../cognicore-baseline-903c3c1/server/node_modules"
  ```
- **Directory Cleanup**: After baseline execution, the worktree is cleanly dismantled:
  ```bash
  git worktree remove ../cognicore-baseline-903c3c1 --force
  ```
