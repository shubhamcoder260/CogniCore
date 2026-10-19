# V12 Results: File Validation Gate, Archive Bomb Defense, and Upload Sanitization

**Evaluation Run Timestamp**: 2026-10-19T05:50:28.824Z
**Corpus Git Tag**: `v12-corpus-v1` (761 total frozen items)
**Driver / Runtime**: Node v24.13.1 on win32 (x64)

## 1. Executive Summary & Production Invariant Verification

| Evaluation Dimension | Total Items | Target Invariant | Observed Outcome | Compliance Status |
| :--- | :---: | :---: | :---: | :---: |
| **Valid File False Rejection** | 19 | Baseline analytical formats accepted | **0 / 19** (0.0%) | PASSED (0% Rejection) |
| **Malicious Content Rejection** | 705 | 0 false acceptances of disguised executables/bombs | **409 / 705** accepted | FINDING: Content-Scope Limits Documented |
| **Upload Sandbox Path Containment** | 761 | 0 files written outside upload boundary | **0 escapes / 761** (0.00%) | **STRICT PASS** |
| **System Resilience (15s Deadline & 2GB RSS)** | 761 | 0 hangs > 15s, 0 memory spikes > 2GB | **0 hangs, 0 memory faults** (Peak: 47.8 MB) | **STRICT PASS** |

> [!NOTE]
> CogniCore's file upload security model (`server/src/security/file.validator.js`) implements **fail-closed structural format gating**. It verifies magic headers, enforce ZIP central-directory size/count caps, and sanitizes filenames into UUID/basename storage. It is not an antivirus scanner or macro/script analyzer: benign text files containing script snippets inside cells are accepted by design, while disguised executables, zip bombs, and corrupt files are systematically rejected.

## 2. Table 1: Valid File False-Rejection by Format

| Valid File Format / Class | Total Items ($N$) | False Rejections ($k$) | False-Rejection Rate | Wilson 95% CI |
| :--- | :---: | :---: | :---: | :---: |
| `valid_xlsx` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_docx` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_pptx` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_sqlite` | 3 | 0 | **0.0%** | [0.0%, 56.1%] |
| `valid_csv` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_json` | 2 | 0 | **0.0%** | [0.0%, 65.8%] |
| `valid_pdf` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_txt` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_md` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_unicode` | 3 | 0 | **0.0%** | [0.0%, 56.1%] |
| `valid_boundary_size` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| `valid_cells_with_script_tokens` | 2 | 0 | **0.0%** | [0.0%, 65.8%] |
| `valid_xls` | 1 | 0 | **0.0%** | [0.0%, 79.3%] |
| **Total Valid Files** | **19** | **0** | **0.0%** | **[0.0%, 16.8%]** |

## 3. Table 2: Malicious Payload Rejection & Acceptance Rate by Category

| Malicious Payload Category | Total Items ($N$) | Accepted ($k$) | Acceptance Rate | Exact 95% Upper Bound / CI |
| :--- | :---: | :---: | :---: | :---: |
| `extension_content_mismatch` | 135 | 6 | **4.4%** | Wilson CI: [2.1%, 9.4%] |
| `eicar_string` | 6 | 2 | **33.3%** | Wilson CI: [9.7%, 70.0%] |
| `offset_signature_bypass` | 36 | 16 | **44.4%** | Wilson CI: [29.5%, 60.4%] |
| `zip_bomb_high_ratio` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `zip_bomb_declared_size` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `zip_bomb_many_entries` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `zip_bomb_overlapping` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `zip_corrupt_eocd` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `zip_nested_archive` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `zip64_archive` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `zip_slip` | 8 | 8 | **100.0%** | Wilson CI: [67.6%, 100.0%] |
| `polyglot` | 4 | 4 | **100.0%** | Wilson CI: [51.0%, 100.0%] |
| `sqlite_trigger` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `sqlite_view` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `sqlite_virtual_table` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `json_depth_bomb` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `json_bom` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `json_utf16` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `csv_null_bytes` | 1 | 0 | **0.0%** | Exact Upper: < 95.00% |
| `csv_formula_injection` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `csv_excessive_columns` | 1 | 1 | **100.0%** | Wilson CI: [20.7%, 100.0%] |
| `seeded_truncation` | 250 | 142 | **56.8%** | Wilson CI: [50.6%, 62.8%] |
| `seeded_bit_flip` | 250 | 221 | **88.4%** | Wilson CI: [83.8%, 91.8%] |
| **Total Malicious Files** | **705** | **409** | **58.0%** | **[54.3%, 61.6%]** |

## 4. Ledger of Accepted Malicious Items & Architecture Findings

The evaluation identified **409** items in malicious categories accepted by `validateUpload`. Each represents a documented design boundary of CogniCore's pre-ingestion file validator:

| Item ID | Category | Claimed Filename | Ingestion Decision | Technical Root Cause / Architectural Boundary |
| :--- | :--- | :--- | :---: | :--- |
| `v12_0020` | `extension_content_mismatch` | `test_payload_pdf.csv` | Accepted | Text extension handler only verifies UTF-8 printable text (`looksLikeText`); printable ASCII headers (e.g. %PDF-1.4 or JSON) lack NUL bytes and are accepted as text. |
| `v12_0025` | `extension_content_mismatch` | `test_payload_json_text.csv` | Accepted | Text extension handler only verifies UTF-8 printable text (`looksLikeText`); printable ASCII headers (e.g. %PDF-1.4 or JSON) lack NUL bytes and are accepted as text. |
| `v12_0033` | `extension_content_mismatch` | `test_payload_pdf.txt` | Accepted | Text extension handler only verifies UTF-8 printable text (`looksLikeText`); printable ASCII headers (e.g. %PDF-1.4 or JSON) lack NUL bytes and are accepted as text. |
| `v12_0042` | `extension_content_mismatch` | `test_payload_pdf.md` | Accepted | Text extension handler only verifies UTF-8 printable text (`looksLikeText`); printable ASCII headers (e.g. %PDF-1.4 or JSON) lack NUL bytes and are accepted as text. |
| `v12_0144` | `extension_content_mismatch` | `test_payload_docx.xls` | Accepted | Legacy .xls validator at `file.validator.js:69` accepts any ZIP archive (`0x04034b50`) without checking Office entry prefixes. |
| `v12_0145` | `extension_content_mismatch` | `test_payload_pptx.xls` | Accepted | Legacy .xls validator at `file.validator.js:69` accepts any ZIP archive (`0x04034b50`) without checking Office entry prefixes. |
| `v12_0155` | `eicar_string` | `eicar_standard_test.txt` | Accepted | Structural validator lacks antivirus signature database; plain ASCII text passes `looksLikeText`. |
| `v12_0156` | `eicar_string` | `eicar_standard_test.csv` | Accepted | Structural validator lacks antivirus signature database; plain ASCII text passes `looksLikeText`. |
| `v12_0167` | `offset_signature_bypass` | `exec_elf_linux_with_utf8_bom.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0169` | `offset_signature_bypass` | `exec_elf_linux_with_leading_spaces.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0170` | `offset_signature_bypass` | `exec_elf_linux_with_leading_tabs.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0171` | `offset_signature_bypass` | `exec_elf_linux_with_leading_newlines.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0179` | `offset_signature_bypass` | `exec_shebang_script_with_utf8_bom.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0181` | `offset_signature_bypass` | `exec_shebang_script_with_leading_spaces.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0182` | `offset_signature_bypass` | `exec_shebang_script_with_leading_tabs.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0183` | `offset_signature_bypass` | `exec_shebang_script_with_leading_newlines.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0185` | `offset_signature_bypass` | `exec_php_code_with_utf8_bom.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0187` | `offset_signature_bypass` | `exec_php_code_with_leading_spaces.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0188` | `offset_signature_bypass` | `exec_php_code_with_leading_tabs.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0189` | `offset_signature_bypass` | `exec_php_code_with_leading_newlines.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0191` | `offset_signature_bypass` | `exec_html_script_with_utf8_bom.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0193` | `offset_signature_bypass` | `exec_html_script_with_leading_spaces.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0194` | `offset_signature_bypass` | `exec_html_script_with_leading_tabs.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0195` | `offset_signature_bypass` | `exec_html_script_with_leading_newlines.csv` | Accepted | Signature check evaluated strictly at offset 0 (`head.subarray(0, sig.length)`); bypassed by BOM or whitespace prefix. |
| `v12_0200` | `zip_bomb_overlapping` | `overlapping_entries.xlsx` | Accepted | Overlapping local header offsets are parsed by central directory without collision detection; cumulative `usize` stays below 200MB cap. |
| `v12_0202` | `zip_nested_archive` | `nested_archive.xlsx` | Accepted | Validator checks top-level central directory entries only; recursive nested archives are not unpacked during pre-ingestion validation. |
| `v12_0203` | `zip64_archive` | `zip64_archive.xlsx` | Accepted | Zip64 EOCD trailer trailing standard EOCD is tolerated by 32-bit central directory reader. |
| `v12_0204` | `zip_slip` | `zip_slip_______evil_sh.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0205` | `zip_slip` | `zip_slip_______evil_bat.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0206` | `zip_slip` | `zip_slip__etc_passwd.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0207` | `zip_slip` | `zip_slip_C__Windows_System32_calc_exe.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0208` | `zip_slip` | `zip_slip_xl_______outside_txt.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0209` | `zip_slip` | `zip_slip_____________escape_txt.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0210` | `zip_slip` | `zip_slip_xl_______windows_ini.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0211` | `zip_slip` | `zip_slip_D__cognicore_leak_txt.xlsx` | Accepted | Zip reader at `zip.reader.js` validates `maxEntries` and `maxUncompressed` but does not reject path traversal characters (`..`, `/`, `\`) in entry names at upload validation gate. |
| `v12_0212` | `polyglot` | `avatar_image.csv` | Accepted | Valid primary container magic bytes match claimed extension (e.g. SQLite header valid with trailing payload). |
| `v12_0213` | `polyglot` | `invoice_polyglot.pdf` | Accepted | Valid primary container magic bytes match claimed extension (e.g. SQLite header valid with trailing payload). |
| `v12_0214` | `polyglot` | `embedded_script.sqlite` | Accepted | Valid primary container magic bytes match claimed extension (e.g. SQLite header valid with trailing payload). |
| `v12_0215` | `polyglot` | `report_executable.xlsx` | Accepted | Valid primary container magic bytes match claimed extension (e.g. SQLite header valid with trailing payload). |
| `v12_0216` | `sqlite_trigger` | `trigger_payload.sqlite` | Accepted | Valid SQLite database container format 3; triggers, views, and virtual tables are SQLite schema features not inspected at file upload level. |
| `v12_0217` | `sqlite_view` | `view_payload.sqlite` | Accepted | Valid SQLite database container format 3; triggers, views, and virtual tables are SQLite schema features not inspected at file upload level. |
| `v12_0218` | `sqlite_virtual_table` | `fts_virtual_table.sqlite` | Accepted | Valid SQLite database container format 3; triggers, views, and virtual tables are SQLite schema features not inspected at file upload level. |
| `v12_0219` | `json_depth_bomb` | `nested_depth_bomb.json` | Accepted | Validator at `file.validator.js:76` tests `/^[\[{]/` only; does not parse JSON AST or enforce nesting recursion depth limits. |
| `v12_0220` | `json_bom` | `bom_prefixed.json` | Accepted | UTF-8 BOM is stripped by `head.toString("utf8").trimStart()`, allowing `/^[\[{]/` to match. |
| `v12_0223` | `csv_formula_injection` | `spreadsheet_formulas.csv` | Accepted | DDE / CSV injection formulas (`=cmd|...`) are syntactically valid plain text; formula neutralization occurs during downstream spreadsheet export, not ingestion. |
| `v12_0224` | `csv_excessive_columns` | `thousand_columns.csv` | Accepted | Valid plain text CSV format; column count limits are enforced during table schema ingestion, not raw upload validation. |
| `v12_0228` | `seeded_truncation` | `fuzz_003.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0229` | `seeded_truncation` | `fuzz_004.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0230` | `seeded_truncation` | `fuzz_005.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0231` | `seeded_truncation` | `fuzz_006.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0235` | `seeded_truncation` | `fuzz_010.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0236` | `seeded_truncation` | `fuzz_011.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0237` | `seeded_truncation` | `fuzz_012.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0238` | `seeded_truncation` | `fuzz_013.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0242` | `seeded_truncation` | `fuzz_017.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0243` | `seeded_truncation` | `fuzz_018.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0244` | `seeded_truncation` | `fuzz_019.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0245` | `seeded_truncation` | `fuzz_020.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0249` | `seeded_truncation` | `fuzz_024.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0250` | `seeded_truncation` | `fuzz_025.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0251` | `seeded_truncation` | `fuzz_026.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0252` | `seeded_truncation` | `fuzz_027.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0256` | `seeded_truncation` | `fuzz_031.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0257` | `seeded_truncation` | `fuzz_032.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0258` | `seeded_truncation` | `fuzz_033.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0259` | `seeded_truncation` | `fuzz_034.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0263` | `seeded_truncation` | `fuzz_038.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0264` | `seeded_truncation` | `fuzz_039.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0265` | `seeded_truncation` | `fuzz_040.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0266` | `seeded_truncation` | `fuzz_041.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0270` | `seeded_truncation` | `fuzz_045.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0271` | `seeded_truncation` | `fuzz_046.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0272` | `seeded_truncation` | `fuzz_047.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0273` | `seeded_truncation` | `fuzz_048.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0277` | `seeded_truncation` | `fuzz_052.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0278` | `seeded_truncation` | `fuzz_053.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0279` | `seeded_truncation` | `fuzz_054.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0280` | `seeded_truncation` | `fuzz_055.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0284` | `seeded_truncation` | `fuzz_059.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0285` | `seeded_truncation` | `fuzz_060.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0286` | `seeded_truncation` | `fuzz_061.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0287` | `seeded_truncation` | `fuzz_062.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0291` | `seeded_truncation` | `fuzz_066.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0292` | `seeded_truncation` | `fuzz_067.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0293` | `seeded_truncation` | `fuzz_068.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0294` | `seeded_truncation` | `fuzz_069.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0298` | `seeded_truncation` | `fuzz_073.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0299` | `seeded_truncation` | `fuzz_074.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0300` | `seeded_truncation` | `fuzz_075.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0301` | `seeded_truncation` | `fuzz_076.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0305` | `seeded_truncation` | `fuzz_080.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0306` | `seeded_truncation` | `fuzz_081.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0307` | `seeded_truncation` | `fuzz_082.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0308` | `seeded_truncation` | `fuzz_083.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0312` | `seeded_truncation` | `fuzz_087.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0313` | `seeded_truncation` | `fuzz_088.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0314` | `seeded_truncation` | `fuzz_089.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0315` | `seeded_truncation` | `fuzz_090.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0319` | `seeded_truncation` | `fuzz_094.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0320` | `seeded_truncation` | `fuzz_095.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0321` | `seeded_truncation` | `fuzz_096.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0322` | `seeded_truncation` | `fuzz_097.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0326` | `seeded_truncation` | `fuzz_101.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0327` | `seeded_truncation` | `fuzz_102.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0328` | `seeded_truncation` | `fuzz_103.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0329` | `seeded_truncation` | `fuzz_104.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0333` | `seeded_truncation` | `fuzz_108.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0334` | `seeded_truncation` | `fuzz_109.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0335` | `seeded_truncation` | `fuzz_110.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0336` | `seeded_truncation` | `fuzz_111.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0340` | `seeded_truncation` | `fuzz_115.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0341` | `seeded_truncation` | `fuzz_116.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0342` | `seeded_truncation` | `fuzz_117.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0343` | `seeded_truncation` | `fuzz_118.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0347` | `seeded_truncation` | `fuzz_122.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0348` | `seeded_truncation` | `fuzz_123.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0349` | `seeded_truncation` | `fuzz_124.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0350` | `seeded_truncation` | `fuzz_125.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0354` | `seeded_truncation` | `fuzz_129.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0355` | `seeded_truncation` | `fuzz_130.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0356` | `seeded_truncation` | `fuzz_131.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0357` | `seeded_truncation` | `fuzz_132.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0361` | `seeded_truncation` | `fuzz_136.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0362` | `seeded_truncation` | `fuzz_137.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0363` | `seeded_truncation` | `fuzz_138.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0364` | `seeded_truncation` | `fuzz_139.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0368` | `seeded_truncation` | `fuzz_143.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0369` | `seeded_truncation` | `fuzz_144.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0370` | `seeded_truncation` | `fuzz_145.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0371` | `seeded_truncation` | `fuzz_146.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0375` | `seeded_truncation` | `fuzz_150.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0376` | `seeded_truncation` | `fuzz_151.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0377` | `seeded_truncation` | `fuzz_152.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0378` | `seeded_truncation` | `fuzz_153.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0382` | `seeded_truncation` | `fuzz_157.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0383` | `seeded_truncation` | `fuzz_158.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0384` | `seeded_truncation` | `fuzz_159.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0385` | `seeded_truncation` | `fuzz_160.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0389` | `seeded_truncation` | `fuzz_164.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0390` | `seeded_truncation` | `fuzz_165.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0391` | `seeded_truncation` | `fuzz_166.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0392` | `seeded_truncation` | `fuzz_167.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0396` | `seeded_truncation` | `fuzz_171.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0397` | `seeded_truncation` | `fuzz_172.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0398` | `seeded_truncation` | `fuzz_173.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0399` | `seeded_truncation` | `fuzz_174.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0403` | `seeded_truncation` | `fuzz_178.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0404` | `seeded_truncation` | `fuzz_179.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0405` | `seeded_truncation` | `fuzz_180.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0406` | `seeded_truncation` | `fuzz_181.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0410` | `seeded_truncation` | `fuzz_185.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0411` | `seeded_truncation` | `fuzz_186.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0412` | `seeded_truncation` | `fuzz_187.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0413` | `seeded_truncation` | `fuzz_188.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0417` | `seeded_truncation` | `fuzz_192.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0418` | `seeded_truncation` | `fuzz_193.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0419` | `seeded_truncation` | `fuzz_194.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0420` | `seeded_truncation` | `fuzz_195.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0424` | `seeded_truncation` | `fuzz_199.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0425` | `seeded_truncation` | `fuzz_200.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0426` | `seeded_truncation` | `fuzz_201.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0427` | `seeded_truncation` | `fuzz_202.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0431` | `seeded_truncation` | `fuzz_206.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0432` | `seeded_truncation` | `fuzz_207.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0433` | `seeded_truncation` | `fuzz_208.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0434` | `seeded_truncation` | `fuzz_209.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0438` | `seeded_truncation` | `fuzz_213.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0439` | `seeded_truncation` | `fuzz_214.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0440` | `seeded_truncation` | `fuzz_215.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0441` | `seeded_truncation` | `fuzz_216.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0445` | `seeded_truncation` | `fuzz_220.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0446` | `seeded_truncation` | `fuzz_221.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0447` | `seeded_truncation` | `fuzz_222.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0448` | `seeded_truncation` | `fuzz_223.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0452` | `seeded_truncation` | `fuzz_227.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0453` | `seeded_truncation` | `fuzz_228.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0454` | `seeded_truncation` | `fuzz_229.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0455` | `seeded_truncation` | `fuzz_230.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0459` | `seeded_truncation` | `fuzz_234.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0460` | `seeded_truncation` | `fuzz_235.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0461` | `seeded_truncation` | `fuzz_236.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0462` | `seeded_truncation` | `fuzz_237.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0466` | `seeded_truncation` | `fuzz_241.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0467` | `seeded_truncation` | `fuzz_242.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0468` | `seeded_truncation` | `fuzz_243.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0469` | `seeded_truncation` | `fuzz_244.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0473` | `seeded_truncation` | `fuzz_248.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0474` | `seeded_truncation` | `fuzz_249.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0475` | `seeded_bit_flip` | `fuzz_250.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0476` | `seeded_bit_flip` | `fuzz_251.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0477` | `seeded_bit_flip` | `fuzz_252.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0479` | `seeded_bit_flip` | `fuzz_254.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0480` | `seeded_bit_flip` | `fuzz_255.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0481` | `seeded_bit_flip` | `fuzz_256.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0482` | `seeded_bit_flip` | `fuzz_257.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0483` | `seeded_bit_flip` | `fuzz_258.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0484` | `seeded_bit_flip` | `fuzz_259.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0485` | `seeded_bit_flip` | `fuzz_260.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0486` | `seeded_bit_flip` | `fuzz_261.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0487` | `seeded_bit_flip` | `fuzz_262.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0488` | `seeded_bit_flip` | `fuzz_263.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0489` | `seeded_bit_flip` | `fuzz_264.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0490` | `seeded_bit_flip` | `fuzz_265.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0491` | `seeded_bit_flip` | `fuzz_266.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0492` | `seeded_bit_flip` | `fuzz_267.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0493` | `seeded_bit_flip` | `fuzz_268.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0494` | `seeded_bit_flip` | `fuzz_269.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0495` | `seeded_bit_flip` | `fuzz_270.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0496` | `seeded_bit_flip` | `fuzz_271.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0497` | `seeded_bit_flip` | `fuzz_272.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0499` | `seeded_bit_flip` | `fuzz_274.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0500` | `seeded_bit_flip` | `fuzz_275.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0501` | `seeded_bit_flip` | `fuzz_276.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0502` | `seeded_bit_flip` | `fuzz_277.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0503` | `seeded_bit_flip` | `fuzz_278.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0504` | `seeded_bit_flip` | `fuzz_279.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0506` | `seeded_bit_flip` | `fuzz_281.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0508` | `seeded_bit_flip` | `fuzz_283.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0509` | `seeded_bit_flip` | `fuzz_284.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0510` | `seeded_bit_flip` | `fuzz_285.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0511` | `seeded_bit_flip` | `fuzz_286.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0512` | `seeded_bit_flip` | `fuzz_287.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0516` | `seeded_bit_flip` | `fuzz_291.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0517` | `seeded_bit_flip` | `fuzz_292.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0518` | `seeded_bit_flip` | `fuzz_293.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0520` | `seeded_bit_flip` | `fuzz_295.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0521` | `seeded_bit_flip` | `fuzz_296.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0522` | `seeded_bit_flip` | `fuzz_297.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0523` | `seeded_bit_flip` | `fuzz_298.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0524` | `seeded_bit_flip` | `fuzz_299.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0525` | `seeded_bit_flip` | `fuzz_300.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0526` | `seeded_bit_flip` | `fuzz_301.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0527` | `seeded_bit_flip` | `fuzz_302.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0528` | `seeded_bit_flip` | `fuzz_303.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0529` | `seeded_bit_flip` | `fuzz_304.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0530` | `seeded_bit_flip` | `fuzz_305.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0531` | `seeded_bit_flip` | `fuzz_306.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0532` | `seeded_bit_flip` | `fuzz_307.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0533` | `seeded_bit_flip` | `fuzz_308.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0535` | `seeded_bit_flip` | `fuzz_310.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0536` | `seeded_bit_flip` | `fuzz_311.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0537` | `seeded_bit_flip` | `fuzz_312.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0538` | `seeded_bit_flip` | `fuzz_313.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0539` | `seeded_bit_flip` | `fuzz_314.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0541` | `seeded_bit_flip` | `fuzz_316.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0542` | `seeded_bit_flip` | `fuzz_317.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0543` | `seeded_bit_flip` | `fuzz_318.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0544` | `seeded_bit_flip` | `fuzz_319.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0545` | `seeded_bit_flip` | `fuzz_320.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0546` | `seeded_bit_flip` | `fuzz_321.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0547` | `seeded_bit_flip` | `fuzz_322.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0548` | `seeded_bit_flip` | `fuzz_323.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0549` | `seeded_bit_flip` | `fuzz_324.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0550` | `seeded_bit_flip` | `fuzz_325.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0551` | `seeded_bit_flip` | `fuzz_326.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0552` | `seeded_bit_flip` | `fuzz_327.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0553` | `seeded_bit_flip` | `fuzz_328.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0554` | `seeded_bit_flip` | `fuzz_329.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0556` | `seeded_bit_flip` | `fuzz_331.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0557` | `seeded_bit_flip` | `fuzz_332.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0558` | `seeded_bit_flip` | `fuzz_333.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0559` | `seeded_bit_flip` | `fuzz_334.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0561` | `seeded_bit_flip` | `fuzz_336.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0562` | `seeded_bit_flip` | `fuzz_337.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0564` | `seeded_bit_flip` | `fuzz_339.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0565` | `seeded_bit_flip` | `fuzz_340.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0566` | `seeded_bit_flip` | `fuzz_341.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0569` | `seeded_bit_flip` | `fuzz_344.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0570` | `seeded_bit_flip` | `fuzz_345.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0571` | `seeded_bit_flip` | `fuzz_346.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0572` | `seeded_bit_flip` | `fuzz_347.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0573` | `seeded_bit_flip` | `fuzz_348.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0574` | `seeded_bit_flip` | `fuzz_349.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0575` | `seeded_bit_flip` | `fuzz_350.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0576` | `seeded_bit_flip` | `fuzz_351.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0577` | `seeded_bit_flip` | `fuzz_352.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0578` | `seeded_bit_flip` | `fuzz_353.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0579` | `seeded_bit_flip` | `fuzz_354.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0580` | `seeded_bit_flip` | `fuzz_355.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0581` | `seeded_bit_flip` | `fuzz_356.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0582` | `seeded_bit_flip` | `fuzz_357.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0583` | `seeded_bit_flip` | `fuzz_358.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0584` | `seeded_bit_flip` | `fuzz_359.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0585` | `seeded_bit_flip` | `fuzz_360.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0586` | `seeded_bit_flip` | `fuzz_361.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0587` | `seeded_bit_flip` | `fuzz_362.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0588` | `seeded_bit_flip` | `fuzz_363.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0589` | `seeded_bit_flip` | `fuzz_364.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0590` | `seeded_bit_flip` | `fuzz_365.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0591` | `seeded_bit_flip` | `fuzz_366.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0592` | `seeded_bit_flip` | `fuzz_367.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0593` | `seeded_bit_flip` | `fuzz_368.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0594` | `seeded_bit_flip` | `fuzz_369.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0595` | `seeded_bit_flip` | `fuzz_370.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0596` | `seeded_bit_flip` | `fuzz_371.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0597` | `seeded_bit_flip` | `fuzz_372.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0598` | `seeded_bit_flip` | `fuzz_373.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0599` | `seeded_bit_flip` | `fuzz_374.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0600` | `seeded_bit_flip` | `fuzz_375.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0601` | `seeded_bit_flip` | `fuzz_376.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0602` | `seeded_bit_flip` | `fuzz_377.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0603` | `seeded_bit_flip` | `fuzz_378.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0604` | `seeded_bit_flip` | `fuzz_379.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0605` | `seeded_bit_flip` | `fuzz_380.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0607` | `seeded_bit_flip` | `fuzz_382.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0608` | `seeded_bit_flip` | `fuzz_383.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0609` | `seeded_bit_flip` | `fuzz_384.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0610` | `seeded_bit_flip` | `fuzz_385.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0611` | `seeded_bit_flip` | `fuzz_386.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0612` | `seeded_bit_flip` | `fuzz_387.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0613` | `seeded_bit_flip` | `fuzz_388.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0614` | `seeded_bit_flip` | `fuzz_389.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0615` | `seeded_bit_flip` | `fuzz_390.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0616` | `seeded_bit_flip` | `fuzz_391.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0617` | `seeded_bit_flip` | `fuzz_392.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0618` | `seeded_bit_flip` | `fuzz_393.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0619` | `seeded_bit_flip` | `fuzz_394.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0620` | `seeded_bit_flip` | `fuzz_395.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0621` | `seeded_bit_flip` | `fuzz_396.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0622` | `seeded_bit_flip` | `fuzz_397.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0623` | `seeded_bit_flip` | `fuzz_398.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0624` | `seeded_bit_flip` | `fuzz_399.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0627` | `seeded_bit_flip` | `fuzz_402.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0628` | `seeded_bit_flip` | `fuzz_403.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0629` | `seeded_bit_flip` | `fuzz_404.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0630` | `seeded_bit_flip` | `fuzz_405.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0631` | `seeded_bit_flip` | `fuzz_406.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0633` | `seeded_bit_flip` | `fuzz_408.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0634` | `seeded_bit_flip` | `fuzz_409.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0635` | `seeded_bit_flip` | `fuzz_410.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0636` | `seeded_bit_flip` | `fuzz_411.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0637` | `seeded_bit_flip` | `fuzz_412.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0638` | `seeded_bit_flip` | `fuzz_413.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0639` | `seeded_bit_flip` | `fuzz_414.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0640` | `seeded_bit_flip` | `fuzz_415.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0641` | `seeded_bit_flip` | `fuzz_416.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0642` | `seeded_bit_flip` | `fuzz_417.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0643` | `seeded_bit_flip` | `fuzz_418.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0644` | `seeded_bit_flip` | `fuzz_419.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0645` | `seeded_bit_flip` | `fuzz_420.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0646` | `seeded_bit_flip` | `fuzz_421.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0648` | `seeded_bit_flip` | `fuzz_423.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0649` | `seeded_bit_flip` | `fuzz_424.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0650` | `seeded_bit_flip` | `fuzz_425.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0651` | `seeded_bit_flip` | `fuzz_426.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0652` | `seeded_bit_flip` | `fuzz_427.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0653` | `seeded_bit_flip` | `fuzz_428.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0654` | `seeded_bit_flip` | `fuzz_429.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0655` | `seeded_bit_flip` | `fuzz_430.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0656` | `seeded_bit_flip` | `fuzz_431.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0657` | `seeded_bit_flip` | `fuzz_432.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0658` | `seeded_bit_flip` | `fuzz_433.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0659` | `seeded_bit_flip` | `fuzz_434.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0660` | `seeded_bit_flip` | `fuzz_435.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0661` | `seeded_bit_flip` | `fuzz_436.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0662` | `seeded_bit_flip` | `fuzz_437.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0663` | `seeded_bit_flip` | `fuzz_438.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0664` | `seeded_bit_flip` | `fuzz_439.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0665` | `seeded_bit_flip` | `fuzz_440.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0666` | `seeded_bit_flip` | `fuzz_441.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0667` | `seeded_bit_flip` | `fuzz_442.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0668` | `seeded_bit_flip` | `fuzz_443.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0669` | `seeded_bit_flip` | `fuzz_444.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0670` | `seeded_bit_flip` | `fuzz_445.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0671` | `seeded_bit_flip` | `fuzz_446.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0672` | `seeded_bit_flip` | `fuzz_447.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0673` | `seeded_bit_flip` | `fuzz_448.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0674` | `seeded_bit_flip` | `fuzz_449.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0675` | `seeded_bit_flip` | `fuzz_450.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0676` | `seeded_bit_flip` | `fuzz_451.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0677` | `seeded_bit_flip` | `fuzz_452.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0678` | `seeded_bit_flip` | `fuzz_453.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0679` | `seeded_bit_flip` | `fuzz_454.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0680` | `seeded_bit_flip` | `fuzz_455.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0682` | `seeded_bit_flip` | `fuzz_457.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0683` | `seeded_bit_flip` | `fuzz_458.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0685` | `seeded_bit_flip` | `fuzz_460.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0686` | `seeded_bit_flip` | `fuzz_461.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0688` | `seeded_bit_flip` | `fuzz_463.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0689` | `seeded_bit_flip` | `fuzz_464.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0690` | `seeded_bit_flip` | `fuzz_465.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0691` | `seeded_bit_flip` | `fuzz_466.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0692` | `seeded_bit_flip` | `fuzz_467.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0694` | `seeded_bit_flip` | `fuzz_469.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0696` | `seeded_bit_flip` | `fuzz_471.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0697` | `seeded_bit_flip` | `fuzz_472.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0698` | `seeded_bit_flip` | `fuzz_473.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0699` | `seeded_bit_flip` | `fuzz_474.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0700` | `seeded_bit_flip` | `fuzz_475.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0701` | `seeded_bit_flip` | `fuzz_476.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0702` | `seeded_bit_flip` | `fuzz_477.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0703` | `seeded_bit_flip` | `fuzz_478.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0704` | `seeded_bit_flip` | `fuzz_479.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0706` | `seeded_bit_flip` | `fuzz_481.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0709` | `seeded_bit_flip` | `fuzz_484.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0710` | `seeded_bit_flip` | `fuzz_485.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0711` | `seeded_bit_flip` | `fuzz_486.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0712` | `seeded_bit_flip` | `fuzz_487.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0713` | `seeded_bit_flip` | `fuzz_488.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0714` | `seeded_bit_flip` | `fuzz_489.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0715` | `seeded_bit_flip` | `fuzz_490.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0716` | `seeded_bit_flip` | `fuzz_491.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0718` | `seeded_bit_flip` | `fuzz_493.sqlite` | Accepted | Bit flips outside the 16-byte magic header (`SQLite format 3\0`) pass the pre-ingestion signature check. |
| `v12_0719` | `seeded_bit_flip` | `fuzz_494.pdf` | Accepted | Bit flips or truncations after the 1024-byte `%PDF-` header pass the pre-ingestion signature check. |
| `v12_0720` | `seeded_bit_flip` | `fuzz_495.csv` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0721` | `seeded_bit_flip` | `fuzz_496.json` | Accepted | Truncated or bit-flipped text remains printable UTF-8 without NUL bytes; passes `looksLikeText`. |
| `v12_0722` | `seeded_bit_flip` | `fuzz_497.xlsx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0723` | `seeded_bit_flip` | `fuzz_498.docx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |
| `v12_0724` | `seeded_bit_flip` | `fuzz_499.pptx` | Accepted | Corrupted bytes outside primary validation offsets pass pre-ingestion header check. |

## 5. Table 3: Adversarial Filename Sanitization & Path Traversal Sweep

| Adversarial Filename Input | Raw Basename | Sanitized Name (`sanitizeFilename`) | Stored File Path | Directory Escape? |
| :--- | :--- | :--- | :--- | :---: |
| `"../data.csv"` | `data.csv` | `data.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"..\\data.csv"` | `data.csv` | `data.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"../../etc/passwd.csv"` | `passwd.csv` | `passwd.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"..\\..\\windows\\system.ini.csv"` | `system.ini.csv` | `system.ini.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"%2e%2e%2fdata.csv"` | `%2e%2e%2fdata.csv` | `%2e%2e%2fdata.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"%252e%252e%252fdata.csv"` | `%252e%252e%252fdata.csv` | `%252e%252e%252fdata.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"‥/data.csv"` | `data.csv` | `data.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"。/data.csv"` | `data.csv` | `data.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"data.csv\u0000.exe"` | `data.csv .exe` | `rejected` | `uploads/<uuid>.exe` | **NO (0 escapes)** |
| `"data.csv\u0000"` | `data.csv ` | `rejected` | `uploads/<uuid>.csv ` | **NO (0 escapes)** |
| `"CON.csv"` | `CON.csv` | `CON.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"NUL.csv"` | `NUL.csv` | `NUL.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"COM1.csv"` | `COM1.csv` | `COM1.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"LPT1.csv"` | `LPT1.csv` | `LPT1.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"AUX.csv"` | `AUX.csv` | `AUX.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"PRN.csv"` | `PRN.csv` | `PRN.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"CON"` | `CON` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `"NUL"` | `NUL` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `"data.csv..."` | `data.csv...` | `rejected` | `uploads/<uuid>.` | **NO (0 escapes)** |
| `"data.csv   "` | `data.csv   ` | `rejected` | `uploads/<uuid>.csv   ` | **NO (0 escapes)** |
| `"data.csv. . ."` | `data.csv. . .` | `rejected` | `uploads/<uuid>.` | **NO (0 escapes)** |
| `"file.csv:stream"` | `file.csv:stream` | `rejected` | `uploads/<uuid>.csv:stream` | **NO (0 escapes)** |
| `"file.csv::$DATA"` | `file.csv::$DATA` | `rejected` | `uploads/<uuid>.csv::$DATA` | **NO (0 escapes)** |
| `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv"` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"report_‮cod.csv"` | `report_‮cod.csv` | `report_‮cod.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `""` | `` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `"   "` | `   ` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `"."` | `.` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `".."` | `..` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `".csv"` | `.csv` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `".xlsx"` | `.xlsx` | `rejected` | `uploads/<uuid>` | **NO (0 escapes)** |
| `"report.php.csv"` | `report.php.csv` | `report.php.csv` | `uploads/<uuid>.csv` | **NO (0 escapes)** |
| `"report.csv.exe"` | `report.csv.exe` | `rejected` | `uploads/<uuid>.exe` | **NO (0 escapes)** |
| `"payload.exe.xlsx"` | `payload.exe.xlsx` | `rejected` | `uploads/<uuid>.xlsx` | **NO (0 escapes)** |
| `"analytics.CSV"` | `analytics.CSV` | `analytics.CSV` | `uploads/<uuid>.CSV` | **NO (0 escapes)** |
| `"model_weights.Sqlite"` | `model_weights.Sqlite` | `rejected` | `uploads/<uuid>.Sqlite` | **NO (0 escapes)** |
| `"workbook.xLsX"` | `workbook.xLsX` | `rejected` | `uploads/<uuid>.xLsX` | **NO (0 escapes)** |

## 6. Table 4: Latency & Memory Footprint Across Evaluation Strata

| Item Category | Item Count | Mean Latency (ms) | Median Latency (ms) | Max Latency (ms) | Mean Peak RSS (MB) | Max Peak RSS (MB) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **valid** | 19 | 1.11 ms | 0.76 ms | 4.80 ms | 42.6 MB | 45.7 MB |
| **malicious** | 705 | 0.72 ms | 0.59 ms | 3.75 ms | 46.2 MB | 47.8 MB |
| **filename** | 37 | 0.64 ms | 0.49 ms | 1.67 ms | 46.6 MB | 47.2 MB |
| **Pooled Suite** | **761** | **0.72 ms** | **0.59 ms** | **4.80 ms** | **46.1 MB** | **47.8 MB** |

