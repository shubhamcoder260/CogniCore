# Domain 6 Fixes: Document Pipeline, Vector RAG & Hybrid Query Engine

## Overview
This document records every vulnerability, architectural bug, heuristic flaw, and security risk diagnosed and resolved in **Domain 6: Document Pipeline, Vector RAG & Hybrid Query Engine**, along with failure mechanisms, root causes, exact code diffs, cross-cutting production invariants, and verification results across all unit and integration test suites.

---

## 6.1 Document Parsing, OCR & Archive Extraction

### Problem & Failure Mechanism
1. **Lexicographical OCR Page Sort Bug (`ocr.js:30`)**:
   `fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()` sorted rendered PDF page images lexicographically. For scanned PDFs with $\ge 10$ pages, `pdftoppm` outputs `p-1.png`, `p-2.png`, ... `p-10.png`, resulting in:
   `['p-1.png', 'p-10.png', 'p-11.png', ..., 'p-2.png']`.
   Page 10 was mapped as Page 2, Page 11 as Page 3, and Page 2 as Page 12, completely scrambling document page ordering and citation anchors.
2. **OCR Image Failure Abort (`ocr.js:15`)**:
   `ocrImage` threw on any single unreadable or noisy image, failing the entire PDF OCR job and leaving temporary directories behind.
3. **PowerPoint Numeric XML Entity Truncation (`parser.js:105`)**:
   `decode()` in `parsePptx` only decoded five named XML entities (`&lt;`, `&gt;`, `&quot;`, `&apos;`, `&amp;`). PowerPoint presentations regularly emit numeric character references for typographic symbols (`&#8217;` for apostrophe, `&#8220;`/`&#8221;` for curly quotes, `&#8212;` for em dash, `&#160;` for non-breaking space), leaving raw unparsed entities in extracted text chunks.
4. **ZIP Reader Header Offset & Size Bounds (`zip.reader.js:17-42`)**:
   `readZipEntries` lacked validation for:
   - Local header offset bounds (`lho + 30 <= buf.length`)
   - Compression method allowlist (enforcing only method 0 stored or method 8 deflate)
   - Compressed size bounds (`lho + 30 + csize <= buf.length`)
   - Re-validation in `read(name)` / `inflateEntry` before decompressing bytes.

### Architectural Solution
1. Changed `files.sort()` to natural numeric sorting:
   `files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))`.
2. Validated `process.env.OCR_LANG` with `/^[a-zA-Z0-9_+]+$/` and returned clean fallback string on image OCR failures.
3. Added decimal (`&#(\d+);`) and hexadecimal (`&#x([0-9a-fA-F]+);`) character reference decoding to `parsePptx`, alongside safe slide buffer extraction.
4. Hardened `zip.reader.js` with central directory bounds guards and local header verification before reading or inflating entries.

---

## 6.2 Structure Detection & Semantic Chunking

### Problem & Failure Mechanism
1. **Chunker Overlap Clamping & Infinite Loop / Truncation Bug (`chunker.js:48-54`)**:
   When `overlapChars >= maxChars`, the first iteration yielded `start = end - overlapChars <= 0`, immediately hitting `if (start <= 0 || end === para.length) break;`. All characters after the first chunk were silently discarded.
2. **Missing Inter-Paragraph Overlap (`chunker.js:38-59`)**:
   When consecutive paragraphs rolled over, `current` was flushed and reset to the new paragraph without overlap, severing semantic context between paragraphs.
3. **All-Caps Heading False Positives in `sections.js:10`**:
   The rule `/^([A-Z][A-Z0-9 &/,\-]{3,70})$/` misclassified SQL queries (`SELECT * FROM USERS`), pagination lines (`PAGE 1 OF 10`), and currency values (`PRICE: $500.00`) as section headings, splitting text into fragmented blocks.

### Architectural Solution
1. Clamped `safeOverlap` to `Math.max(0, Math.min(overlapChars, Math.floor(safeMax / 2)))` and guaranteed `start` advancement (`nextStart > start ? nextStart : start + 1`).
2. Carried forward `overlapSeed = current.slice(-safeOverlap).trim()` when paragraph transitions roll over.
3. Excluded SQL keywords, page numbers, and currency markers from heading classification in `headingOf()`.

---

## 6.3 Vector Storage & Similarity Math

### Problem & Failure Mechanism
1. **Cosine Similarity Floating-Point Overflow & NaN Poisoning (`vector.store.js:87-97`)**:
   Unclamped division and vectors containing `NaN` produced `NaN` scores, poisoning JavaScript's TimSort comparator and corrupting candidate rankings.
2. **Uncaught JSON Parsing in Database Scans (`vector.store.js:80`)**:
   `JSON.parse(r.embedding_json)` crashed `VectorStore.search` if any row in the SQLite database contained invalid or corrupted JSON.
3. **Embedder Array Alignment (`embedder.js:12`)**:
   `embedAndStore` did not verify vector count against chunk count, allowing missing vectors to be saved as `"null"`.

### Architectural Solution
1. Clamped `cosineSimilarity` strictly to `[-1, 1]` with numerical type-coercion (`Number(x) || 0`) and finite validation.
2. Encapsulated database scans and `JSON.parse` in try/catch boundaries, skipping corrupt rows gracefully.
3. Verified embedding provider vector counts against batch sizes in `embedder.js`.

---

## 6.4 BM25 Lexical Scoring, Reranker & Retrieval Engine

### Problem & Failure Mechanism
1. **Stemmer Truncation Collisions (`reranker.js:10`)**:
   The naive stemmer `w.replace(/(ing|ed|es|s)$/, '')` stripped suffixes without minimum length guards:
   - `"king"` $\rightarrow$ `"k"`, `"ring"` $\rightarrow$ `"r"`, `"bed"` $\rightarrow$ `"b"`, `"feed"` $\rightarrow$ `"fe"`, `"class"` $\rightarrow$ `"cl"`.
   A query with `"king"` matched any document containing the letter `"k"`.
2. **Stopword-Only Scaling Penalty (`reranker.js:42`)**:
   When queries had only stop words (e.g. `"What is it?"`), `lex = 0` caused the final score to be scaled by `alpha = 0.6`, penalizing strong semantic embeddings.
3. **Null/Undefined Query Safety in `tok()` (`reranker.js:9`)**:
   `tok(null)` returned `['null']`, treating `"null"` as a lexical query term.

### Architectural Solution
1. Implemented minimum root length guards:
   - `-ing` stripped only if `w.length > 5` (e.g. `working` $\rightarrow$ `work`, preserving `king`)
   - `-ed` stripped only if `w.length > 4` (e.g. `tested` $\rightarrow$ `test`, preserving `bed`, `red`)
   - `-es` stripped only if `w.length > 4` and not ending in `sses`
   - `-s` stripped only if `w.length > 3` and not ending in `ss`, `us`, `is`.
2. In `rerank()`, when `hasLexicalTerms` is false, `rerankScore` defaults directly to `dense + sectionHit` without scaling penalty.
3. Normalized inputs in `tok(s)` to return `[]` for null, undefined, or empty values.

---

## 6.5 Document Ingestion & Multi-Source Routing

### Problem & Failure Mechanism
1. **Multi-Document Selection Dropped in Query Planner (`query.planner.js:68`)**:
   Selecting multiple document datasets routed to `DOCUMENT` using only `documentDatasets[0]`, dropping all other documents.
2. **Staged Upload Disk Leak on Ingestion Failure (`upload.js:43-47`)**:
   If file parsing or embedding failed during upload, the temporary file in `config.paths.uploads` remained orphaned on disk.

### Architectural Solution
1. Routed multiple document datasets to `HYBRID` in `query.planner.js`:
   `{ routeType: 'HYBRID', structuredDataset: null, documentDataset: documentDatasets[0], structuredDatasets: [], documentDatasets }`.
2. Wrapped `ingestFile` in a try/catch block inside `upload.js` ensuring `fs.rmSync(req.file.path, { force: true })` on any failure.

---

## 6.6 Hybrid Engine, Fault Isolation & Grounding Guardrails

### Problem & Failure Mechanism
1. **Unprotected `Promise.all` in Hybrid Execution (`hybrid.engine.js:36-39`)**:
   If any single sub-query rejected, `Promise.all` rejected the entire hybrid request, discarding working evidence from other datasets.
2. **Page & Section Citations Flagged as Hallucinations (`answer.grounding.js:34`)**:
   `evidenceNumbers()` only extracted numbers from `c.text`. When the synthesizer cited page numbers (`c.page = 42`) or section numerals (`c.section = "2.1"`), `checkNumericGrounding` flagged them as ungrounded numbers.
3. **Prompt Injection Fencing Breaches in Prompt Composer (`answer.composer.js:8, 15, 30`)**:
   Dataset names and incomplete error reasons containing `</untrusted_data>` or role markers escaped prompt boundaries.
4. **Follow-Up State Missing Document Previews (`followup.resolver.js:26`)**:
   `summarizePreview` returned `''` for non-database sources, depriving follow-up LLM rewrites of previous document context.

### Architectural Solution
1. Wrapped individual sub-engine executions in try/catch error boundaries inside `runHybridQuery`, preserving partial evidence and recording failures in `incomplete`.
2. Added `c.page` and `c.section` numerals to `evidenceNumbers()` in `answer.grounding.js`.
3. Sanitized dataset names, section headings, and incomplete reasons using `neutralizeInjection` in `answer.composer.js`.
4. Extracted document chunk excerpts in `summarizePreview` for cross-modal conversation state.

---

## Test Verification Matrix

All unit, security, and integration test suites pass at 100% across both repositories:

| Suite | File | Tests | Pass Rate |
| :--- | :--- | :--- | :--- |
| **Domain 6 Unit Suite** | `tests/unit/domain6-documents-rag.test.js` | 19 / 19 | **100%** |
| **Existing Document Integration** | `tests/integration/documents.test.js` | 6 / 6 | **100%** |
| **Existing Chunker Unit** | `tests/unit/chunker.test.js` | 5 / 5 | **100%** |
| **CogniCore Server Full Suite** | `npm test` (`CogniCore/server`) | 318 / 318 | **100%** |
| **Validation Workspace Full Suite** | `npm test` (`validation_workspace/server`) | 277 / 277 | **100%** |
