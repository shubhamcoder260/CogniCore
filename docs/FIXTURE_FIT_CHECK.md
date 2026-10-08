# CogniCore — Fixture Fit-Check & Generatability Matrix

## Executive Summary & Database Inventory

Offline, read-only profiling of all 15 test databases in `database/` using `better-sqlite3`.

| DB | Domain | Tables | Rows | Dates? | FKs Declared / Detected | Generatable Categories | Est. Questions | Flags |
|---|---|---:|---:|---|:---:|:---:|---:|---|
| **B1_community.db** | bank | 4 | 2,763 | No | 0 / 3 | 11/12 categories | **298** | ABBREVIATED_SCHEMA |
| **B2_district.db** | bank | 4 | 20,145 | Yes (MIXED) | 3 / 2 | 12/12 categories | **241** | STANDARD |
| **B3_metro.db** | bank | 4 | 66,347 | Yes (MIXED) | 3 / 2 | 12/12 categories | **241** | STANDARD |
| **F1_quickbite.db** | fooddelivery | 6 | 6,515 | No | 0 / 5 | 11/12 categories | **367** | ABBREVIATED_SCHEMA |
| **F2_citygrub.db** | fooddelivery | 6 | 42,531 | Yes (ISO-TEXT) | 0 / 5 | 12/12 categories | **336** | STANDARD |
| **F3_national.db** | fooddelivery | 6 | 1,92,417 | Yes (ISO-TEXT) | 0 / 5 | 12/12 categories | **336** | STANDARD |
| **H1_clinic.db** | hospital | 6 | 6,594 | Yes (MIXED) | 0 / 4 | 12/12 categories | **399** | STANDARD |
| **H2_legacymed.db** | hospital | 5 | 3,42,751 | No | 0 / 1 | 11/12 categories | **271** | ABBREVIATED_SCHEMA |
| **H3_metropol.db** | hospital | 9 | 53,430 | Yes (MIXED) | 0 / 7 | 12/12 categories | **790** | STANDARD |
| **I1_workshop.db** | industry | 3 | 3,330 | No | 0 / 1 | 11/12 categories | **211** | ABBREVIATED_SCHEMA |
| **I2_factory.db** | industry | 3 | 51,836 | Yes (MIXED) | 0 / 1 | 12/12 categories | **186** | STANDARD |
| **I3_plantops.db** | industry | 3 | 3,88,238 | Yes (MIXED) | 0 / 1 | 12/12 categories | **160** | STANDARD |
| **U1_stateuniv.db** | university | 5 | 1,823 | No | 8 / 3 | 11/12 categories | **612** | STANDARD |
| **U2_metrouniv.db** | university | 5 | 17,911 | No | 8 / 3 | 11/12 categories | **414** | STANDARD |
| **U3_institute.db** | university | 5 | 72,096 | No | 0 / 5 | 11/12 categories | **345** | ABBREVIATED_SCHEMA |

---

## F7. Generatability Matrix (All 15 DBs × 12 Categories)

| DB | basic_count | filtered_count | scalar_aggregate | filtered_aggregate | ratio | group_by | temporal | ranking | join | existence | multi_condition | comparative | Total Est Qs |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|
| **B1_community.db** | **GEN** (8) | **GEN** (28) | **GEN** (18) | **GEN** (20) | **GEN** (9) | **GEN** (126) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (18) | **GEN** (9) | **GEN** (6) | **GEN** (28) | **GEN** (28) | **298** |
| **B2_district.db** | **GEN** (8) | **GEN** (20) | **GEN** (18) | **GEN** (20) | **GEN** (9) | **GEN** (90) | **GEN** (3) | **GEN** (18) | **GEN** (9) | **GEN** (6) | **GEN** (20) | **GEN** (20) | **241** |
| **B3_metro.db** | **GEN** (8) | **GEN** (20) | **GEN** (18) | **GEN** (20) | **GEN** (9) | **GEN** (90) | **GEN** (3) | **GEN** (18) | **GEN** (9) | **GEN** (6) | **GEN** (20) | **GEN** (20) | **241** |
| **F1_quickbite.db** | **GEN** (12) | **GEN** (30) | **GEN** (22) | **GEN** (20) | **GEN** (11) | **GEN** (165) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (22) | **GEN** (15) | **GEN** (10) | **GEN** (30) | **GEN** (30) | **367** |
| **F2_citygrub.db** | **GEN** (12) | **GEN** (26) | **GEN** (22) | **GEN** (20) | **GEN** (11) | **GEN** (143) | **GEN** (3) | **GEN** (22) | **GEN** (15) | **GEN** (10) | **GEN** (26) | **GEN** (26) | **336** |
| **F3_national.db** | **GEN** (12) | **GEN** (26) | **GEN** (22) | **GEN** (20) | **GEN** (11) | **GEN** (143) | **GEN** (3) | **GEN** (22) | **GEN** (15) | **GEN** (10) | **GEN** (26) | **GEN** (26) | **336** |
| **H1_clinic.db** | **GEN** (12) | **GEN** (34) | **GEN** (22) | **GEN** (20) | **GEN** (11) | **GEN** (187) | **GEN** (3) | **GEN** (22) | **GEN** (12) | **GEN** (8) | **GEN** (34) | **GEN** (34) | **399** |
| **H2_legacymed.db** | **GEN** (10) | **GEN** (28) | **GEN** (16) | **GEN** (20) | **GEN** (8) | **GEN** (112) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (16) | **GEN** (3) | **GEN** (2) | **GEN** (28) | **GEN** (28) | **271** |
| **H3_metropol.db** | **GEN** (18) | **GEN** (52) | **GEN** (36) | **GEN** (20) | **GEN** (18) | **GEN** (468) | **GEN** (3) | **GEN** (36) | **GEN** (21) | **GEN** (14) | **GEN** (52) | **GEN** (52) | **790** |
| **I1_workshop.db** | **GEN** (6) | **GEN** (20) | **GEN** (16) | **GEN** (20) | **GEN** (8) | **GEN** (80) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (16) | **GEN** (3) | **GEN** (2) | **GEN** (20) | **GEN** (20) | **211** |
| **I2_factory.db** | **GEN** (6) | **GEN** (18) | **GEN** (14) | **GEN** (20) | **GEN** (7) | **GEN** (63) | **GEN** (3) | **GEN** (14) | **GEN** (3) | **GEN** (2) | **GEN** (18) | **GEN** (18) | **186** |
| **I3_plantops.db** | **GEN** (6) | **GEN** (14) | **GEN** (14) | **GEN** (20) | **GEN** (7) | **GEN** (49) | **GEN** (3) | **GEN** (14) | **GEN** (3) | **GEN** (2) | **GEN** (14) | **GEN** (14) | **160** |
| **U1_stateuniv.db** | **GEN** (10) | **GEN** (42) | **GEN** (32) | **GEN** (20) | **GEN** (16) | **GEN** (336) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (32) | **GEN** (24) | **GEN** (16) | **GEN** (42) | **GEN** (42) | **612** |
| **U2_metrouniv.db** | **GEN** (10) | **GEN** (24) | **GEN** (32) | **GEN** (20) | **GEN** (16) | **GEN** (192) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (32) | **GEN** (24) | **GEN** (16) | **GEN** (24) | **GEN** (24) | **414** |
| **U3_institute.db** | **GEN** (10) | **GEN** (22) | **GEN** (28) | **GEN** (20) | **GEN** (14) | **GEN** (154) | <span style="color:gray;">SKIP:no_temporal_columns</span> | **GEN** (28) | **GEN** (15) | **GEN** (10) | **GEN** (22) | **GEN** (22) | **345** |

---

## F5. Relationship Detector Cross-Check (Declared FKs vs Naming Heuristic)

Validation of the engine's `relationship.detector.detectRelationships()` (S11) against declared ground truth foreign keys:

| DB | Declared FKs | Heuristic Detected | Agreed | Declared-Only (Missed) | Heuristic-Only (Discovered) | Agreement Rate |
|---|---:|---:|---:|---:|---:|---:|
| **B1_community.db** | 0 | 3 | **0** | 0 | 3 | N/A |
| **B2_district.db** | 3 | 2 | **2** | 1 | 0 | 67% |
| **B3_metro.db** | 3 | 2 | **2** | 1 | 0 | 67% |
| **F1_quickbite.db** | 0 | 5 | **0** | 0 | 5 | N/A |
| **F2_citygrub.db** | 0 | 5 | **0** | 0 | 5 | N/A |
| **F3_national.db** | 0 | 5 | **0** | 0 | 5 | N/A |
| **H1_clinic.db** | 0 | 4 | **0** | 0 | 4 | N/A |
| **H2_legacymed.db** | 0 | 1 | **0** | 0 | 1 | N/A |
| **H3_metropol.db** | 0 | 7 | **0** | 0 | 7 | N/A |
| **I1_workshop.db** | 0 | 1 | **0** | 0 | 1 | N/A |
| **I2_factory.db** | 0 | 1 | **0** | 0 | 1 | N/A |
| **I3_plantops.db** | 0 | 1 | **0** | 0 | 1 | N/A |
| **U1_stateuniv.db** | 8 | 3 | **3** | 5 | 0 | 38% |
| **U2_metrouniv.db** | 8 | 3 | **3** | 5 | 0 | 38% |
| **U3_institute.db** | 0 | 5 | **0** | 0 | 5 | N/A |

### Detailed Cross-Check Discrepancies

#### B1_community.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `accts.br_id` → `brs.br_id`
  - `lns.acct_id` → `accts.acct_id`
  - `txns.acct_id` → `accts.acct_id`

#### B2_district.db
- **Declared-Only (Heuristic Missed due to Non-Standard / Abbreviated Naming)**:
  - `accounts.branch_id` → `branches.branch_id`

#### B3_metro.db
- **Declared-Only (Heuristic Missed due to Non-Standard / Abbreviated Naming)**:
  - `accounts.branch_id` → `branches.branch_id`

#### F1_quickbite.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `mnu.rst_id` → `rst.rst_id`
  - `oi.ord_id` → `ords.ord_id`
  - `ords.cst_id` → `cst.cst_id`
  - `ords.rst_id` → `rst.rst_id`
  - `ords.cur_id` → `cur.cur_id`

#### F2_citygrub.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `menu_items.restaurant_id` → `restaurants.restaurant_id`
  - `order_items.order_id` → `orders.order_id`
  - `orders.customer_id` → `customers.customer_id`
  - `orders.restaurant_id` → `restaurants.restaurant_id`
  - `orders.courier_id` → `couriers.courier_id`

#### F3_national.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `menu_items.restaurant_id` → `restaurants.restaurant_id`
  - `order_items.order_id` → `orders.order_id`
  - `orders.customer_id` → `customers.customer_id`
  - `orders.restaurant_id` → `restaurants.restaurant_id`
  - `orders.courier_id` → `couriers.courier_id`

#### H1_clinic.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `diagnoses.visit_id` → `visits.visit_id`
  - `prescriptions.visit_id` → `visits.visit_id`
  - `visits.patient_id` → `patients.patient_id`
  - `visits.doctor_id` → `doctors.doc_id`

#### H2_legacymed.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `vsts.doc_id` → `docs.doc_id`

#### H3_metropol.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `appointments.patient_id` → `patients.patient_id`
  - `appointments.doctor_id` → `doctors.doc_id`
  - `diagnoses.visit_id` → `visits.visit_id`
  - `lab_tests.visit_id` → `visits.visit_id`
  - `prescriptions.visit_id` → `visits.visit_id`
  - `visits.patient_id` → `patients.patient_id`
  - `visits.doctor_id` → `doctors.doc_id`

#### I1_workshop.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `prod.mc_id` → `mcs.mc_id`

#### I2_factory.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `production_runs.machine_id` → `machines.machine_id`

#### I3_plantops.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `production_runs.machine_id` → `machines.machine_id`

#### U1_stateuniv.db
- **Declared-Only (Heuristic Missed due to Non-Standard / Abbreviated Naming)**:
  - `courses.dept_id` → `departments.dept_id`
  - `instructors.advisor_id` → `instructors.instructor_id`
  - `instructors.dept_id` → `departments.dept_id`
  - `students.advisor_id` → `instructors.instructor_id`
  - `students.dept_id` → `departments.dept_id`

#### U2_metrouniv.db
- **Declared-Only (Heuristic Missed due to Non-Standard / Abbreviated Naming)**:
  - `courses.dept_id` → `departments.dept_id`
  - `instructors.advisor_id` → `instructors.instructor_id`
  - `instructors.dept_id` → `departments.dept_id`
  - `students.advisor_id` → `instructors.instructor_id`
  - `students.dept_id` → `departments.dept_id`

#### U3_institute.db
- **Heuristic-Only (Naming Match without Declared SQLite Constraint)**:
  - `crss.dept_id` → `depts.dept_id`
  - `crss.prof_id` → `profs.prof_id`
  - `enrs.stu_id` → `stus.stu_id`
  - `profs.dept_id` → `depts.dept_id`
  - `stus.dept_id` → `depts.dept_id`

---

## F6. Tier Cross-Checks (Domain Trio Schema Evolution)

### Domain: BANK (B1_community.db ↔ B2_district.db ↔ B3_metro.db)

#### Table Mapping Across Tiers:
| Conceptual Entity | Tier 1 (Small) | Tier 2 (Canonical) | Tier 3 (Enterprise) |
|---|---|---|---|
| **branches** | `brs` | `branches` | `branches` |
| **accounts** | `accts` | `accounts` | `accounts` |
| **transactions** | `txns` | `transactions` | `transactions` |
| **loans** | `lns` | `loans` | `loans` |

- **Column Type Consistency**: **100% matched** (0 type discrepancies for same-named columns across tiers).

### Domain: FOODDELIVERY (F1_quickbite.db ↔ F2_citygrub.db ↔ F3_national.db)

#### Table Mapping Across Tiers:
| Conceptual Entity | Tier 1 (Small) | Tier 2 (Canonical) | Tier 3 (Enterprise) |
|---|---|---|---|
| **restaurants** | `rst` | `restaurants` | `restaurants` |
| **menu_items** | `mnu` | `menu_items` | `menu_items` |
| **customers** | `cst` | `customers` | `customers` |
| **couriers** | `cur` | `couriers` | `couriers` |
| **orders** | `ords` | `orders` | `orders` |
| **order_items** | `oi` | `order_items` | `order_items` |

- **Column Type Consistency**: **100% matched** (0 type discrepancies for same-named columns across tiers).

### Domain: HOSPITAL (H1_clinic.db ↔ H2_legacymed.db ↔ H3_metropol.db)

#### Table Mapping Across Tiers:
| Conceptual Entity | Tier 1 (Small) | Tier 2 (Canonical) | Tier 3 (Enterprise) |
|---|---|---|---|
| **doctors** | `doctors` | `docs` | `doctors` |
| **patients** | `patients` | `pts` | `patients` |
| **visits** | `visits` | `vsts` | `visits` |
| **diagnoses** | `diagnoses` | `dx` | `diagnoses` |
| **prescriptions** | `prescriptions` | `rx` | `prescriptions` |
| **departments (dropped in H2, denormalized into dept_nm)** | `departments` | `(none)` | `departments` |
| **appointments (Tier 3 addition)** | `(none)` | `(none)` | `appointments` |
| **lab_tests (Tier 3 addition)** | `(none)` | `(none)` | `lab_tests` |
| **wards (Tier 3 addition)** | `(none)` | `(none)` | `wards` |

- **Tables Added in Tier 3**: `appointments`, `lab_tests`, `wards`
- **Table Discrepancy**: `departments` — departments dropped in Tier 2 (H2_legacymed.db)
- **Column Type Consistency**: **100% matched** (0 type discrepancies for same-named columns across tiers).

### Domain: INDUSTRY (I1_workshop.db ↔ I2_factory.db ↔ I3_plantops.db)

#### Table Mapping Across Tiers:
| Conceptual Entity | Tier 1 (Small) | Tier 2 (Canonical) | Tier 3 (Enterprise) |
|---|---|---|---|
| **machines** | `mcs` | `machines` | `machines` |
| **production_runs** | `prod` | `production_runs` | `production_runs` |
| **defect_log** | `dfc` | `defect_log` | `defect_log` |

- **Column Type Consistency**: **100% matched** (0 type discrepancies for same-named columns across tiers).

### Domain: UNIVERSITY (U1_stateuniv.db ↔ U2_metrouniv.db ↔ U3_institute.db)

#### Table Mapping Across Tiers:
| Conceptual Entity | Tier 1 (Small) | Tier 2 (Canonical) | Tier 3 (Enterprise) |
|---|---|---|---|
| **departments** | `departments` | `departments` | `depts` |
| **instructors** | `instructors` | `instructors` | `profs` |
| **students** | `students` | `students` | `stus` |
| **courses** | `courses` | `courses` | `crss` |
| **enrollments** | `enrollments` | `enrollments` | `enrs` |

- **Column Type Consistency**: **100% matched** (0 type discrepancies for same-named columns across tiers).

---

## F8. Naming-Stress Target List (A/B Repair Baseline)

Verbatim abbreviated identifiers and canonical expansions for the A/B SQL repair pipeline:

| Database | Abbreviated Table (Verbatim) | Canonical Expansion (GUESS) | Verification Source |
|---|---|---|---|
| **B1_community.db** | `accts` | **`accounts`** | B2/B3 accounts |
| **B1_community.db** | `brs` | **`branches`** | B2/B3 branches |
| **B1_community.db** | `lns` | **`loans`** | B2/B3 loans |
| **B1_community.db** | `txns` | **`transactions`** | B2/B3 transactions |
| **F1_quickbite.db** | `cst` | **`customers`** | F2/F3 customers |
| **F1_quickbite.db** | `cur` | **`couriers`** | F2/F3 couriers |
| **F1_quickbite.db** | `mnu` | **`menu_items`** | F2/F3 menu_items |
| **F1_quickbite.db** | `oi` | **`order_items`** | F2/F3 order_items |
| **F1_quickbite.db** | `ords` | **`orders`** | F2/F3 orders |
| **F1_quickbite.db** | `rst` | **`restaurants`** | F2/F3 restaurants |
| **H2_legacymed.db** | `docs` | **`doctors`** | H1/H3 doctors |
| **H2_legacymed.db** | `dx` | **`diagnoses`** | H1/H3 diagnoses |
| **H2_legacymed.db** | `pts` | **`patients`** | H1/H3 patients |
| **H2_legacymed.db** | `rx` | **`prescriptions`** | H1/H3 prescriptions |
| **H2_legacymed.db** | `vsts` | **`visits`** | H1/H3 visits |
| **I1_workshop.db** | `dfc` | **`defect_log`** | I2/I3 defect_log |
| **I1_workshop.db** | `mcs` | **`machines`** | I2/I3 machines |
| **I1_workshop.db** | `prod` | **`production_runs`** | I2/I3 production_runs |
| **U3_institute.db** | `crss` | **`courses`** | U1/U2 courses |
| **U3_institute.db** | `depts` | **`departments`** | U1/U2 departments |
| **U3_institute.db** | `enrs` | **`enrollments`** | U1/U2 enrollments |
| **U3_institute.db** | `profs` | **`instructors (professors)`** | U1/U2 instructors |
| **U3_institute.db** | `stus` | **`students`** | U1/U2 students |

---

## Per-Database Detailed Profiles (F1–F4)

### B1_community.db (bank)
- **Location**: `bank/B1_community.db` (156 KB)
- **Total Rows**: 2,763 across 4 tables

#### Tables & Columns (F1)
- **`accts`** (200 rows): `acct_id` (INTEGER, PK), `holder_nm` (TEXT), `br_id` (INTEGER), `acct_typ` (TEXT), `status` (TEXT), `bal` (REAL), `opn_yr` (INTEGER)
- **`brs`** (6 rows): `br_id` (INTEGER, PK), `br_nm` (TEXT), `city` (TEXT)
- **`lns`** (38 rows): `ln_id` (INTEGER, PK), `acct_id` (INTEGER), `prin` (REAL), `rate` (INTEGER), `dur` (INTEGER), `status` (TEXT)
- **`txns`** (2,519 rows): `txn_id` (INTEGER, PK), `acct_id` (INTEGER), `txn_typ` (TEXT), `amt` (REAL), `txn_dt` (TEXT)

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `accts` | `br_id` | 6 | "4" (38), "6" (36), "3" (33), "5" (32), "2" (31) |
| `accts` | `acct_typ` | 4 | "Savings" (53), "Fixed Deposit" (53), "Current" (51), "Salary" (43) |
| `accts` | `status` | 3 | "Active" (125), "Frozen" (44), "Dormant" (31) |
| `accts` | `opn_yr` | 8 | "2023" (36), "2024" (29), "2020" (26), "2022" (25), "2021" (25) |
| `brs` | `br_id` | 6 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `brs` | `br_nm` | 6 | "BR_06" (1), "BR_05" (1), "BR_04" (1), "BR_03" (1), "BR_02" (1) |
| `brs` | `city` | 4 | "Pune" (2), "Mumbai" (2), "Delhi" (1), "Bangalore" (1) |
| `lns` | `ln_id` | 38 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `lns` | `acct_id` | 38 | "192" (1), "181" (1), "180" (1), "177" (1), "176" (1) |
| `lns` | `prin` | 38 | "4940098" (1), "4619486" (1), "4584778" (1), "4535954" (1), "4480540" (1) |
| `lns` | `rate` | 8 | "13" (8), "10" (6), "11" (5), "9" (5), "12" (4) |
| `lns` | `dur` | 34 | "81" (2), "77" (2), "76" (2), "63" (2), "84" (1) |
| `lns` | `status` | 3 | "Active" (18), "Closed" (12), "Defaulted" (8) |
| `txns` | `txn_typ` | 5 | "TRANSFER_IN" (535), "WITHDRAWAL" (517), "TRANSFER_OUT" (507), "BILL_PAYMENT" (483), "DEPOSIT" (477) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `accts` | `br_id` | 1 | 6 | 3.6 | 0.0% | 0 |
| `accts` | `bal` | -3591 | 499215 | 228234.33 | 0.0% | 5 |
| `accts` | `opn_yr` | 2018 | 2025 | 2021.55 | 0.0% | 0 |
| `lns` | `acct_id` | 4 | 192 | 102.11 | 0.0% | 0 |
| `lns` | `prin` | 193060 | 4940098 | 2474435.53 | 0.0% | 0 |
| `lns` | `rate` | 7 | 14 | 10.71 | 0.0% | 0 |
| `lns` | `dur` | 17 | 84 | 57.82 | 0.0% | 0 |
| `txns` | `acct_id` | 1 | 200 | 99.45 | 0.0% | 0 |
| `txns` | `amt` | 163.92 | 199927.63 | 100538.96 | 0.0% | 0 |

---

### B2_district.db (bank)
- **Location**: `bank/B2_district.db` (1672 KB)
- **Total Rows**: 20,145 across 4 tables

#### Tables & Columns (F1)
- **`accounts`** (1,500 rows): `account_id` (INTEGER, PK), `holder_name` (TEXT), `branch_id` (INTEGER), `account_type` (TEXT), `status` (TEXT), `balance` (REAL), `open_year` (INTEGER)
- **`branches`** (6 rows): `branch_id` (INTEGER, PK), `branch_name` (TEXT), `city` (TEXT)
- **`loans`** (303 rows): `loan_id` (INTEGER, PK), `account_id` (INTEGER), `principal` (REAL), `interest_rate_pct` (INTEGER), `duration_months` (INTEGER), `status` (TEXT)
- **`transactions`** (18,336 rows): `txn_id` (INTEGER, PK), `account_id` (INTEGER), `txn_type` (TEXT), `amount` (REAL), `txn_date` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `accounts` | `open_year` | **MIXED (OTHER-TEXT (2018), OTHER-TEXT (2021), OTHER-TEXT (2019), OTHER-TEXT (2023), OTHER-TEXT (2020), OTHER-TEXT (2024), OTHER-TEXT (2022), OTHER-TEXT (2025))** | `2018` | `2025` | `2018, 2021` |
| `loans` | `duration_months` | **MIXED (OTHER-TEXT (76), OTHER-TEXT (30), OTHER-TEXT (40), OTHER-TEXT (67), OTHER-TEXT (80), OTHER-TEXT (68), OTHER-TEXT (61), OTHER-TEXT (81), OTHER-TEXT (14), OTHER-TEXT (32), OTHER-TEXT (78), OTHER-TEXT (15), OTHER-TEXT (38), OTHER-TEXT (71), OTHER-TEXT (48), OTHER-TEXT (82), OTHER-TEXT (50), OTHER-TEXT (65), OTHER-TEXT (34))** | `12` | `84` | `76, 30` |
| `transactions` | `txn_date` | **ISO-TEXT (YYYY-MM-DD HH:MM:SS)** | `2023-01-01 10:26:00` | `2025-12-28 9:51:00` | `2023-01-01 10:26:00, 2023-01-01 10:29:00` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `accounts` | `branch_id` | 6 | "3" (282), "2" (255), "5" (253), "6" (247), "1" (233) |
| `accounts` | `account_type` | 4 | "Fixed Deposit" (395), "Current" (373), "Salary" (368), "Savings" (364) |
| `accounts` | `status` | 3 | "Active" (897), "Dormant" (309), "Frozen" (294) |
| `accounts` | `open_year` | 8 | "2020" (209), "2019" (194), "2024" (191), "2021" (189), "2022" (188) |
| `branches` | `branch_id` | 6 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `branches` | `branch_name` | 6 | "Riverside Branch" (1), "Metro Branch" (1), "Hillview Branch" (1), "Downtown Branch" (1), "Central Branch" (1) |
| `branches` | `city` | 2 | "Mumbai" (4), "Delhi" (2) |
| `loans` | `interest_rate_pct` | 8 | "7" (44), "13" (43), "12" (43), "9" (40), "14" (38) |
| `loans` | `status` | 3 | "Active" (150), "Defaulted" (86), "Closed" (67) |
| `transactions` | `txn_type` | 5 | "TRANSFER_OUT" (3712), "BILL_PAYMENT" (3683), "DEPOSIT" (3664), "WITHDRAWAL" (3654), "TRANSFER_IN" (3623) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `accounts` | `branch_id` | 1 | 6 | 3.5 | 0.0% | 0 |
| `accounts` | `balance` | -4860 | 499890 | 242926.08 | 0.0% | 13 |
| `accounts` | `open_year` | 2018 | 2025 | 2021.51 | 0.0% | 0 |
| `loans` | `account_id` | 4 | 1497 | 747.92 | 0.0% | 0 |
| `loans` | `principal` | 90488 | 4921335 | 2438752.57 | 0.0% | 0 |
| `loans` | `interest_rate_pct` | 7 | 14 | 10.57 | 0.0% | 0 |
| `loans` | `duration_months` | 12 | 84 | 46.46 | 0.0% | 0 |
| `transactions` | `account_id` | 1 | 1500 | 758.29 | 0.0% | 0 |
| `transactions` | `amount` | 130 | 199988.08 | 99356.28 | 0.0% | 0 |

---

### B3_metro.db (bank)
- **Location**: `bank/B3_metro.db` (5604 KB)
- **Total Rows**: 66,347 across 4 tables

#### Tables & Columns (F1)
- **`accounts`** (4,000 rows): `account_id` (INTEGER, PK), `holder_name` (TEXT), `branch_id` (INTEGER), `account_type` (TEXT), `status` (TEXT), `balance` (REAL), `open_year` (INTEGER)
- **`branches`** (6 rows): `branch_id` (INTEGER, PK), `branch_name` (TEXT), `city` (TEXT)
- **`loans`** (871 rows): `loan_id` (INTEGER, PK), `account_id` (INTEGER), `principal` (REAL), `interest_rate_pct` (INTEGER), `duration_months` (INTEGER), `status` (TEXT)
- **`transactions`** (61,470 rows): `txn_id` (INTEGER, PK), `account_id` (INTEGER), `txn_type` (TEXT), `amount` (REAL), `txn_date` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `accounts` | `open_year` | **MIXED (OTHER-TEXT (2021), OTHER-TEXT (2019), OTHER-TEXT (2018), OTHER-TEXT (2022), OTHER-TEXT (2025), OTHER-TEXT (2020), OTHER-TEXT (2023), OTHER-TEXT (2024))** | `2018` | `2025` | `2021, 2019` |
| `loans` | `duration_months` | **MIXED (OTHER-TEXT (62), OTHER-TEXT (21), OTHER-TEXT (39), OTHER-TEXT (56), OTHER-TEXT (25), OTHER-TEXT (15), OTHER-TEXT (60), OTHER-TEXT (69), OTHER-TEXT (41), OTHER-TEXT (59), OTHER-TEXT (48), OTHER-TEXT (53), OTHER-TEXT (50), OTHER-TEXT (38), OTHER-TEXT (67), OTHER-TEXT (12), OTHER-TEXT (57))** | `12` | `84` | `62, 21` |
| `transactions` | `txn_date` | **ISO-TEXT (YYYY-MM-DD HH:MM:SS)** | `2023-01-01 10:25:00` | `2025-12-28 9:59:00` | `2023-01-01 10:25:00, 2023-01-01 10:42:00` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `accounts` | `branch_id` | 6 | "2" (708), "6" (681), "3" (678), "1" (664), "5" (648) |
| `accounts` | `account_type` | 4 | "Current" (1024), "Fixed Deposit" (1002), "Savings" (995), "Salary" (979) |
| `accounts` | `status` | 3 | "Active" (2377), "Frozen" (845), "Dormant" (778) |
| `accounts` | `open_year` | 8 | "2019" (522), "2020" (518), "2023" (513), "2025" (503), "2022" (496) |
| `branches` | `branch_id` | 6 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `branches` | `branch_name` | 6 | "Riverside Branch" (1), "Metro Branch" (1), "Hillview Branch" (1), "Downtown Branch" (1), "Central Branch" (1) |
| `branches` | `city` | 3 | "Bangalore" (3), "Mumbai" (2), "Pune" (1) |
| `loans` | `interest_rate_pct` | 8 | "12" (116), "7" (116), "9" (115), "8" (113), "13" (110) |
| `loans` | `status` | 3 | "Active" (418), "Defaulted" (228), "Closed" (225) |
| `transactions` | `txn_type` | 5 | "DEPOSIT" (12336), "WITHDRAWAL" (12300), "TRANSFER_OUT" (12296), "BILL_PAYMENT" (12286), "TRANSFER_IN" (12252) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `accounts` | `branch_id` | 1 | 6 | 3.48 | 0.0% | 0 |
| `accounts` | `balance` | -4862 | 499910 | 246992.51 | 0.0% | 48 |
| `accounts` | `open_year` | 2018 | 2025 | 2021.48 | 0.0% | 0 |
| `loans` | `account_id` | 2 | 4000 | 2042.63 | 0.0% | 0 |
| `loans` | `principal` | 54360 | 4999002 | 2310522.2 | 0.0% | 0 |
| `loans` | `interest_rate_pct` | 7 | 14 | 10.43 | 0.0% | 0 |
| `loans` | `duration_months` | 12 | 84 | 47.83 | 0.0% | 0 |
| `transactions` | `account_id` | 1 | 4000 | 1986.45 | 0.0% | 0 |
| `transactions` | `amount` | 114.8 | 199991.23 | 100306.38 | 0.0% | 0 |

---

### F1_quickbite.db (fooddelivery)
- **Location**: `fooddelivery/F1_quickbite.db` (260 KB)
- **Total Rows**: 6,515 across 6 tables

#### Tables & Columns (F1)
- **`cst`** (200 rows): `cst_id` (INTEGER, PK), `cst_nm` (TEXT), `ph` (TEXT)
- **`cur`** (30 rows): `cur_id` (INTEGER, PK), `cur_nm` (TEXT), `veh` (TEXT)
- **`mnu`** (194 rows): `itm_id` (INTEGER, PK), `rst_id` (INTEGER), `itm_nm` (TEXT), `prc` (REAL), `cat` (TEXT), `veg` (INTEGER)
- **`oi`** (4,561 rows): `ord_id` (INTEGER), `itm_id` (INTEGER), `qty` (INTEGER)
- **`ords`** (1,500 rows): `ord_id` (INTEGER, PK), `cst_id` (INTEGER), `rst_id` (INTEGER), `cur_id` (INTEGER), `ord_dt` (TEXT), `tot_amt` (REAL), `st` (TEXT)
- **`rst`** (30 rows): `rst_id` (INTEGER, PK), `rst_nm` (TEXT), `cusin` (TEXT), `city` (TEXT), `rat` (REAL)

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `cur` | `cur_id` | 30 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `cur` | `cur_nm` | 30 | "CUR_030" (1), "CUR_029" (1), "CUR_028" (1), "CUR_027" (1), "CUR_026" (1) |
| `cur` | `veh` | 3 | "Scooter" (13), "Bike" (11), "Cycle" (6) |
| `mnu` | `rst_id` | 30 | "29" (8), "27" (8), "25" (8), "21" (8), "20" (8) |
| `mnu` | `cat` | 6 | "Starters" (39), "Beverages" (34), "Main Course" (33), "Desserts" (31), "Breads" (29) |
| `mnu` | `veg` | 2 | "0" (102), "1" (92) |
| `oi` | `qty` | 3 | "3" (1540), "2" (1515), "1" (1506) |
| `ords` | `rst_id` | 30 | "12" (65), "10" (64), "27" (61), "11" (60), "21" (60) |
| `ords` | `cur_id` | 30 | "21" (67), "12" (63), "2" (62), "26" (59), "5" (58) |
| `ords` | `st` | 4 | "Delivered" (1010), "Cancelled" (178), "Out for Delivery" (158), "Preparing" (154) |
| `rst` | `rst_id` | 30 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `rst` | `rst_nm` | 30 | "RST_030" (1), "RST_029" (1), "RST_028" (1), "RST_027" (1), "RST_026" (1) |
| `rst` | `cusin` | 7 | "Continental" (5), "Chinese" (5), "South Indian" (4), "North Indian" (4), "Mughlai" (4) |
| `rst` | `city` | 5 | "Pune" (8), "Mumbai" (8), "Bangalore" (6), "Delhi" (5), "Hyderabad" (3) |
| `rst` | `rat` | 17 | "4.9" (3), "4.4" (3), "3.9" (3), "3.7" (3), "3.1" (3) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `mnu` | `rst_id` | 1 | 30 | 15.53 | 0.0% | 0 |
| `mnu` | `prc` | 56.18 | 448.36 | 255.9 | 0.0% | 0 |
| `mnu` | `veg` | 0 | 1 | 0.47 | 0.0% | 0 |
| `oi` | `ord_id` | 2 | 1500 | 750.89 | 0.0% | 0 |
| `oi` | `itm_id` | 1 | 194 | 96.05 | 0.0% | 0 |
| `oi` | `qty` | 1 | 3 | 2.01 | 0.0% | 0 |
| `ords` | `cst_id` | 1 | 200 | 100.86 | 0.0% | 0 |
| `ords` | `rst_id` | 1 | 30 | 15.35 | 0.0% | 0 |
| `ords` | `cur_id` | 1 | 30 | 15.95 | 0.0% | 0 |
| `ords` | `tot_amt` | 221.83 | 5100.93 | 1819.99 | 0.0% | 0 |
| `rst` | `rat` | 3 | 5 | 3.95 | 0.0% | 0 |

---

### F2_citygrub.db (fooddelivery)
- **Location**: `fooddelivery/F2_citygrub.db` (1532 KB)
- **Total Rows**: 42,531 across 6 tables

#### Tables & Columns (F1)
- **`couriers`** (30 rows): `courier_id` (INTEGER, PK), `courier_name` (TEXT), `vehicle` (TEXT)
- **`customers`** (1,000 rows): `customer_id` (INTEGER, PK), `customer_name` (TEXT), `phone` (TEXT)
- **`menu_items`** (465 rows): `item_id` (INTEGER, PK), `restaurant_id` (INTEGER), `item_name` (TEXT), `price` (REAL), `category` (TEXT), `is_veg` (INTEGER)
- **`order_items`** (30,956 rows): `order_id` (INTEGER), `item_id` (INTEGER), `quantity` (INTEGER)
- **`orders`** (10,000 rows): `order_id` (INTEGER, PK), `customer_id` (INTEGER), `restaurant_id` (INTEGER), `courier_id` (INTEGER), `order_date` (TEXT), `total_amount` (REAL), `status` (TEXT)
- **`restaurants`** (80 rows): `restaurant_id` (INTEGER, PK), `restaurant_name` (TEXT), `cuisine` (TEXT), `city` (TEXT), `rating` (REAL)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `orders` | `order_date` | **ISO-TEXT (YYYY-MM-DD HH:MM:SS)** | `2024-01-01 10:01:00` | `2025-12-28 23:46:00` | `2024-07-09 22:20:00, 2025-08-12 22:27:00` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `couriers` | `courier_id` | 30 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `couriers` | `courier_name` | 25 | "Priya Khan" (3), "Ingrid Rossi" (2), "Hana Rossi" (2), "Felix Rossi" (2), "Zara Rossi" (1) |
| `couriers` | `vehicle` | 3 | "Bike" (17), "Scooter" (9), "Cycle" (4) |
| `menu_items` | `item_name` | 15 | "Rogan Josh" (69), "Fish Curry" (35), "Butter Chicken" (35), "Vada Pav" (30), "Tandoori Chicken" (29) |
| `menu_items` | `category` | 6 | "Main Course" (99), "Breads" (82), "Rice" (76), "Starters" (74), "Desserts" (67) |
| `menu_items` | `is_veg` | 2 | "1" (234), "0" (231) |
| `order_items` | `quantity` | 3 | "3" (10426), "1" (10269), "2" (10261) |
| `orders` | `courier_id` | 30 | "30" (359), "24" (358), "26" (352), "20" (348), "9" (348) |
| `orders` | `status` | 4 | "Delivered" (6701), "Cancelled" (1116), "Preparing" (1092), "Out for Delivery" (1091) |
| `restaurants` | `restaurant_name` | 10 | "Wok Express " (8), "Tandoor House II" (8), "Sweet Truth III" (8), "Spice Junction " (8), "Punjabi Rasoi Express" (8) |
| `restaurants` | `cuisine` | 7 | "Mughlai" (17), "Fast Food" (15), "Desserts" (11), "Continental" (11), "South Indian" (9) |
| `restaurants` | `city` | 5 | "Bangalore" (19), "Delhi" (18), "Pune" (17), "Hyderabad" (17), "Mumbai" (9) |
| `restaurants` | `rating` | 21 | "4.1" (9), "4.8" (7), "3.4" (7), "3.7" (5), "3.2" (5) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `menu_items` | `restaurant_id` | 1 | 80 | 41.17 | 0.0% | 0 |
| `menu_items` | `price` | 49.89 | 449.58 | 250.16 | 0.0% | 0 |
| `menu_items` | `is_veg` | 0 | 1 | 0.5 | 0.0% | 0 |
| `order_items` | `order_id` | 1 | 10000 | 4991.35 | 0.0% | 0 |
| `order_items` | `item_id` | 1 | 465 | 228.93 | 0.0% | 0 |
| `order_items` | `quantity` | 1 | 3 | 2.01 | 0.0% | 0 |
| `orders` | `customer_id` | 1 | 1000 | 502.64 | 0.0% | 0 |
| `orders` | `restaurant_id` | 1 | 80 | 40.33 | 0.0% | 0 |
| `orders` | `courier_id` | 1 | 30 | 15.63 | 0.0% | 0 |
| `orders` | `total_amount` | 134.39 | 5816.38 | 1783.07 | 0.0% | 0 |
| `restaurants` | `rating` | 3 | 5 | 3.98 | 0.0% | 0 |

---

### F3_national.db (fooddelivery)
- **Location**: `fooddelivery/F3_national.db` (7140 KB)
- **Total Rows**: 1,92,417 across 6 tables

#### Tables & Columns (F1)
- **`couriers`** (30 rows): `courier_id` (INTEGER, PK), `courier_name` (TEXT), `vehicle` (TEXT)
- **`customers`** (6,000 rows): `customer_id` (INTEGER, PK), `customer_name` (TEXT), `phone` (TEXT)
- **`menu_items`** (1,194 rows): `item_id` (INTEGER, PK), `restaurant_id` (INTEGER), `item_name` (TEXT), `price` (REAL), `category` (TEXT), `is_veg` (INTEGER)
- **`order_items`** (1,39,993 rows): `order_id` (INTEGER), `item_id` (INTEGER), `quantity` (INTEGER)
- **`orders`** (45,000 rows): `order_id` (INTEGER, PK), `customer_id` (INTEGER), `restaurant_id` (INTEGER), `courier_id` (INTEGER), `order_date` (TEXT), `total_amount` (REAL), `status` (TEXT)
- **`restaurants`** (200 rows): `restaurant_id` (INTEGER, PK), `restaurant_name` (TEXT), `cuisine` (TEXT), `city` (TEXT), `rating` (REAL)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `orders` | `order_date` | **ISO-TEXT (YYYY-MM-DD HH:MM:SS)** | `2024-01-01 10:03:00` | `2025-12-28 23:52:00` | `2025-01-28 21:47:00, 2024-11-04 21:06:00` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `couriers` | `courier_id` | 30 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `couriers` | `courier_name` | 25 | "Tariq Tanaka" (3), "Lena Novak" (2), "Ingrid Kim" (2), "Diego Kim" (2), "Zara Kim" (1) |
| `couriers` | `vehicle` | 3 | "Bike" (15), "Cycle" (10), "Scooter" (5) |
| `menu_items` | `item_name` | 15 | "Rogan Josh" (162), "Hyderabadi Biryani" (88), "Butter Chicken" (86), "Dal Makhani" (84), "Chole Bhature" (84) |
| `menu_items` | `category` | 6 | "Beverages" (207), "Rice" (205), "Main Course" (197), "Starters" (195), "Desserts" (195) |
| `menu_items` | `is_veg` | 2 | "1" (613), "0" (581) |
| `order_items` | `quantity` | 3 | "1" (46833), "2" (46791), "3" (46369) |
| `orders` | `courier_id` | 30 | "11" (1599), "27" (1592), "7" (1555), "15" (1552), "21" (1536) |
| `orders` | `status` | 4 | "Delivered" (29973), "Preparing" (5020), "Out for Delivery" (5006), "Cancelled" (5001) |
| `restaurants` | `restaurant_name` | 10 | "Wok Express " (20), "Tandoor House II" (20), "Sweet Truth III" (20), "Spice Junction " (20), "Punjabi Rasoi Express" (20) |
| `restaurants` | `cuisine` | 7 | "South Indian" (34), "Mughlai" (33), "Fast Food" (33), "Continental" (29), "Desserts" (27) |
| `restaurants` | `city` | 5 | "Bangalore" (47), "Pune" (44), "Mumbai" (37), "Delhi" (37), "Hyderabad" (35) |
| `restaurants` | `rating` | 21 | "4.5" (15), "4.1" (14), "4.8" (13), "4.7" (13), "3.7" (13) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `menu_items` | `restaurant_id` | 1 | 200 | 101.5 | 0.0% | 0 |
| `menu_items` | `price` | 49 | 449.87 | 248.85 | 0.0% | 0 |
| `menu_items` | `is_veg` | 0 | 1 | 0.51 | 0.0% | 0 |
| `order_items` | `order_id` | 1 | 45000 | 22506.36 | 0.0% | 0 |
| `order_items` | `item_id` | 1 | 1194 | 592.83 | 0.0% | 0 |
| `order_items` | `quantity` | 1 | 3 | 2 | 0.0% | 0 |
| `orders` | `customer_id` | 1 | 6000 | 3009.21 | 0.0% | 0 |
| `orders` | `restaurant_id` | 1 | 200 | 100.59 | 0.0% | 0 |
| `orders` | `courier_id` | 1 | 30 | 15.49 | 0.0% | 0 |
| `orders` | `total_amount` | 118.28 | 6301.92 | 1777.75 | 0.0% | 0 |
| `restaurants` | `rating` | 3 | 5 | 4.05 | 0.0% | 0 |

---

### H1_clinic.db (hospital)
- **Location**: `hospital/H1_clinic.db` (312 KB)
- **Total Rows**: 6,594 across 6 tables

#### Tables & Columns (F1)
- **`departments`** (7 rows): `dept_id` (INTEGER, PK), `name` (TEXT), `floor` (INTEGER)
- **`diagnoses`** (2,244 rows): `dx_id` (INTEGER, PK), `visit_id` (INTEGER), `code` (TEXT), `diagnosis` (TEXT), `severity` (TEXT)
- **`doctors`** (25 rows): `doc_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `experience_yrs` (INTEGER)
- **`patients`** (400 rows): `patient_id` (INTEGER, PK), `patient_name` (TEXT), `age` (INTEGER), `gender` (TEXT), `phone` (TEXT), `blood_group` (TEXT)
- **`prescriptions`** (1,235 rows): `rx_id` (INTEGER, PK), `visit_id` (INTEGER), `medicine` (TEXT), `duration_days` (INTEGER)
- **`visits`** (2,683 rows): `visit_id` (INTEGER, PK), `patient_id` (INTEGER), `doctor_id` (INTEGER), `dept_id` (INTEGER), `visit_date` (TEXT), `fee` (REAL), `status` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `prescriptions` | `duration_days` | **MIXED (OTHER-TEXT (13), OTHER-TEXT (17), OTHER-TEXT (16), OTHER-TEXT (30), OTHER-TEXT (21), OTHER-TEXT (22), OTHER-TEXT (12), OTHER-TEXT (27), OTHER-TEXT (18), OTHER-TEXT (23), OTHER-TEXT (28), OTHER-TEXT (10), OTHER-TEXT (8), OTHER-TEXT (25))** | `3` | `30` | `13, 17` |
| `visits` | `visit_date` | **ISO-TEXT (YYYY-MM-DD)** | `2023-01-01` | `2025-12-28` | `2025-03-06, 2024-02-02` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `departments` | `dept_id` | 7 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `departments` | `name` | 7 | "Pediatrics" (1), "Orthopedics" (1), "Oncology" (1), "Neurology" (1), "General Medicine" (1) |
| `departments` | `floor` | 5 | "2" (2), "1" (2), "5" (1), "4" (1), "3" (1) |
| `diagnoses` | `code` | 8 | "R07" (313), "E11" (285), "K29" (284), "J45" (279), "N39" (273) |
| `diagnoses` | `diagnosis` | 8 | "Chest Pain" (313), "Type 2 Diabetes" (285), "Gastritis" (284), "Asthma" (279), "Urinary Tract Infection" (273) |
| `diagnoses` | `severity` | 3 | "Mild" (758), "Moderate" (750), "Severe" (736) |
| `doctors` | `doc_id` | 25 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `doctors` | `name` | 25 | "Dr. Viktor Okafor" (1), "Dr. Viktor Ahmed" (1), "Dr. Tariq Iyer" (1), "Dr. Samir Kim" (1), "Dr. Rohan Khan" (1) |
| `doctors` | `dept_id` | 7 | "4" (4), "3" (4), "2" (4), "1" (4), "7" (3) |
| `doctors` | `experience_yrs` | 17 | "7" (4), "29" (2), "27" (2), "26" (2), "5" (2) |
| `patients` | `gender` | 2 | "M" (219), "F" (181) |
| `patients` | `blood_group` | 8 | "O-" (58), "AB-" (55), "B+" (54), "B-" (53), "A+" (53) |
| `prescriptions` | `medicine` | 8 | "Omeprazole" (164), "Sertraline" (158), "Amoxicillin" (158), "Lisinopril" (154), "Atorvastatin" (153) |
| `prescriptions` | `duration_days` | 28 | "28" (60), "27" (54), "21" (51), "25" (50), "11" (50) |
| `visits` | `doctor_id` | 25 | "3" (131), "2" (126), "9" (125), "11" (119), "16" (118) |
| `visits` | `dept_id` | 7 | "4" (407), "5" (390), "7" (388), "2" (387), "6" (385) |
| `visits` | `status` | 3 | "Completed" (1806), "Cancelled" (439), "Follow-up" (438) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `departments` | `floor` | 1 | 5 | 2.57 | 0.0% | 0 |
| `diagnoses` | `visit_id` | 1 | 2683 | 1337.27 | 0.0% | 0 |
| `doctors` | `dept_id` | 1 | 7 | 3.76 | 0.0% | 0 |
| `doctors` | `experience_yrs` | 2 | 29 | 16 | 0.0% | 0 |
| `patients` | `age` | 1 | 92 | 47.67 | 0.0% | 0 |
| `prescriptions` | `visit_id` | 1 | 2683 | 1320.79 | 0.0% | 0 |
| `prescriptions` | `duration_days` | 3 | 30 | 16.51 | 0.0% | 0 |
| `visits` | `patient_id` | 1 | 400 | 200.77 | 0.0% | 0 |
| `visits` | `doctor_id` | 1 | 25 | 12.71 | 0.0% | 0 |
| `visits` | `dept_id` | 1 | 7 | 4.04 | 0.0% | 0 |
| `visits` | `fee` | 200 | 4997 | 2598.6 | 0.0% | 0 |

---

### H2_legacymed.db (hospital)
- **Location**: `hospital/H2_legacymed.db` (14524 KB)
- **Total Rows**: 3,42,751 across 5 tables

#### Tables & Columns (F1)
- **`docs`** (25 rows): `doc_id` (INTEGER, PK), `doc_nm` (TEXT), `dept_nm` (TEXT), `yrs_exp` (INTEGER)
- **`dx`** (1,19,249 rows): `dx_id` (INTEGER, PK), `visit_id` (INTEGER), `dx_code` (TEXT), `dx_nm` (TEXT), `severity` (TEXT)
- **`pts`** (15,000 rows): `pat_id` (INTEGER, PK), `pat_nm` (TEXT), `age` (INTEGER), `sex` (TEXT), `phone` (TEXT), `blood` (TEXT)
- **`rx`** (65,586 rows): `rx_id` (INTEGER, PK), `visit_id` (INTEGER), `med_nm` (TEXT), `dur_days` (INTEGER)
- **`vsts`** (1,42,891 rows): `visit_id` (INTEGER, PK), `pat_id` (INTEGER), `doc_id` (INTEGER), `dept_nm` (TEXT), `adm_dt` (TEXT), `fee` (REAL), `status` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `rx` | `dur_days` | **MIXED (OTHER-TEXT (7), OTHER-TEXT (24), OTHER-TEXT (15), OTHER-TEXT (6), OTHER-TEXT (25), OTHER-TEXT (3), OTHER-TEXT (13), OTHER-TEXT (29), OTHER-TEXT (8), OTHER-TEXT (27), OTHER-TEXT (26), OTHER-TEXT (30), OTHER-TEXT (16), OTHER-TEXT (14))** | `3` | `30` | `7, 24` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `docs` | `doc_id` | 25 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `docs` | `doc_nm` | 24 | "Dr. Silva, Felix" (2), "Dr. Weber, Kiran" (1), "Dr. Tanaka, Omar" (1), "Dr. Silva, Tariq" (1), "Dr. Silva, Kiran" (1) |
| `docs` | `dept_nm` | 7 | "Pediatrics" (4), "Orthopedics" (4), "Neurology" (4), "Cardiology" (4), "Oncology" (3) |
| `docs` | `yrs_exp` | 13 | "9" (5), "7" (4), "10" (3), "21" (2), "18" (2) |
| `dx` | `dx_code` | 8 | "K29" (15086), "I10" (15077), "F41" (14982), "J45" (14936), "M54" (14856) |
| `dx` | `dx_nm` | 8 | "Gastritis" (15086), "Hypertension" (15077), "Anxiety Disorder" (14982), "Asthma" (14936), "Low Back Pain" (14856) |
| `dx` | `severity` | 3 | "Severe" (40048), "Mild" (39639), "Moderate" (39562) |
| `pts` | `sex` | 2 | "F" (7620), "M" (7380) |
| `pts` | `blood` | 8 | "B-" (1927), "A-" (1897), "O-" (1889), "A+" (1883), "AB-" (1874) |
| `rx` | `med_nm` | 8 | "Albuterol" (8303), "Omeprazole" (8293), "Metformin" (8290), "Ibuprofen" (8246), "Atorvastatin" (8181) |
| `rx` | `dur_days` | 28 | "3" (2475), "14" (2430), "7" (2410), "29" (2407), "5" (2391) |
| `vsts` | `doc_id` | 25 | "9" (5798), "8" (5798), "19" (5793), "7" (5792), "23" (5770) |
| `vsts` | `dept_nm` | 7 | "Orthopedics" (20586), "Cardiology" (20579), "Pediatrics" (20570), "Emergency" (20383), "Oncology" (20307) |
| `vsts` | `status` | 3 | "Completed" (95369), "Follow-up" (23880), "Cancelled" (23642) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `docs` | `yrs_exp` | 6 | 28 | 13.76 | 0.0% | 0 |
| `dx` | `visit_id` | 1 | 142891 | 71312.36 | 0.0% | 0 |
| `pts` | `age` | 1 | 92 | 46.3 | 0.0% | 0 |
| `rx` | `visit_id` | 2 | 142891 | 71525.69 | 0.0% | 0 |
| `rx` | `dur_days` | 3 | 30 | 16.47 | 0.0% | 0 |
| `vsts` | `pat_id` | 1 | 15000 | 7492.94 | 0.0% | 0 |
| `vsts` | `doc_id` | 1 | 25 | 13 | 0.0% | 0 |
| `vsts` | `fee` | 200 | 5000 | 2607.15 | 0.0% | 0 |

---

### H3_metropol.db (hospital)
- **Location**: `hospital/H3_metropol.db` (2132 KB)
- **Total Rows**: 53,430 across 9 tables

#### Tables & Columns (F1)
- **`appointments`** (6,571 rows): `appt_id` (INTEGER, PK), `patient_id` (INTEGER), `doctor_id` (INTEGER), `appt_day` (INTEGER), `appt_month` (INTEGER), `appt_year` (INTEGER)
- **`departments`** (7 rows): `dept_id` (INTEGER, PK), `name` (TEXT), `floor` (INTEGER)
- **`diagnoses`** (13,715 rows): `dx_id` (INTEGER, PK), `visit_id` (INTEGER), `code` (TEXT), `diagnosis` (TEXT), `severity` (TEXT)
- **`doctors`** (25 rows): `doc_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `experience_yrs` (INTEGER)
- **`lab_tests`** (6,183 rows): `lab_id` (INTEGER, PK), `visit_id` (INTEGER), `test_code` (TEXT), `result` (TEXT)
- **`patients`** (3,000 rows): `patient_id` (INTEGER, PK), `patient_name` (TEXT), `age` (INTEGER), `gender` (TEXT), `phone` (TEXT), `blood_group` (TEXT)
- **`prescriptions`** (7,493 rows): `rx_id` (INTEGER, PK), `visit_id` (INTEGER), `medicine` (TEXT), `duration_days` (INTEGER)
- **`visits`** (16,428 rows): `visit_id` (INTEGER, PK), `patient_id` (INTEGER), `doctor_id` (INTEGER), `dept_id` (INTEGER), `visit_date` (TEXT), `fee` (REAL), `status` (TEXT)
- **`wards`** (8 rows): `ward_id` (INTEGER, PK), `ward_name` (TEXT), `beds` (INTEGER)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `appointments` | `appt_day` | **MIXED (OTHER-TEXT (8), OTHER-TEXT (12), OTHER-TEXT (7), OTHER-TEXT (24), OTHER-TEXT (3), OTHER-TEXT (22), OTHER-TEXT (1), OTHER-TEXT (13), OTHER-TEXT (26), OTHER-TEXT (23), OTHER-TEXT (17), OTHER-TEXT (25), OTHER-TEXT (20), OTHER-TEXT (11))** | `1` | `28` | `8, 12` |
| `appointments` | `appt_month` | **MIXED (OTHER-TEXT (10), OTHER-TEXT (3), OTHER-TEXT (6), OTHER-TEXT (9), OTHER-TEXT (11), OTHER-TEXT (12), OTHER-TEXT (1), OTHER-TEXT (5), OTHER-TEXT (7), OTHER-TEXT (4))** | `1` | `12` | `10, 10` |
| `appointments` | `appt_year` | **MIXED (OTHER-TEXT (2025), OTHER-TEXT (2026))** | `2025` | `2026` | `2025, 2026` |
| `prescriptions` | `duration_days` | **MIXED (OTHER-TEXT (25), OTHER-TEXT (8), OTHER-TEXT (14), OTHER-TEXT (3), OTHER-TEXT (30), OTHER-TEXT (20), OTHER-TEXT (9), OTHER-TEXT (6), OTHER-TEXT (28), OTHER-TEXT (26), OTHER-TEXT (24), OTHER-TEXT (12), OTHER-TEXT (5), OTHER-TEXT (11), OTHER-TEXT (21), OTHER-TEXT (29))** | `3` | `30` | `25, 8` |
| `visits` | `visit_date` | **ISO-TEXT (YYYY-MM-DD)** | `2023-01-01` | `2025-12-28` | `2024-08-05, 2023-08-11` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `appointments` | `doctor_id` | 25 | "13" (294), "19" (292), "14" (289), "2" (289), "9" (286) |
| `appointments` | `appt_day` | 28 | "4" (272), "25" (254), "10" (247), "8" (247), "6" (247) |
| `appointments` | `appt_month` | 12 | "5" (574), "1" (567), "7" (565), "12" (563), "9" (559) |
| `appointments` | `appt_year` | 2 | "2025" (3293), "2026" (3278) |
| `departments` | `dept_id` | 7 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `departments` | `name` | 7 | "Pediatrics" (1), "Orthopedics" (1), "Oncology" (1), "Neurology" (1), "General Medicine" (1) |
| `departments` | `floor` | 5 | "2" (2), "1" (2), "5" (1), "4" (1), "3" (1) |
| `diagnoses` | `code` | 8 | "N39" (1778), "K29" (1754), "R07" (1752), "E11" (1732), "F41" (1706) |
| `diagnoses` | `diagnosis` | 8 | "Urinary Tract Infection" (1778), "Gastritis" (1754), "Chest Pain" (1752), "Type 2 Diabetes" (1732), "Anxiety Disorder" (1706) |
| `diagnoses` | `severity` | 3 | "Moderate" (4667), "Mild" (4538), "Severe" (4510) |
| `doctors` | `doc_id` | 25 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `doctors` | `name` | 25 | "Dr. Yuki Jain" (1), "Dr. Viktor Silva" (1), "Dr. Viktor Khan" (1), "Dr. Rohan Sharma" (1), "Dr. Rohan Costa" (1) |
| `doctors` | `dept_id` | 7 | "4" (4), "3" (4), "2" (4), "1" (4), "7" (3) |
| `doctors` | `experience_yrs` | 17 | "21" (3), "29" (2), "24" (2), "20" (2), "19" (2) |
| `lab_tests` | `test_code` | 6 | "LIPID" (1058), "LFT" (1051), "URINE" (1035), "XRAY" (1026), "CBC" (1026) |
| `lab_tests` | `result` | 3 | "Normal" (2080), "Borderline" (2064), "Abnormal" (2039) |
| `patients` | `gender` | 2 | "F" (1502), "M" (1498) |
| `patients` | `blood_group` | 8 | "B-" (394), "O-" (389), "AB-" (379), "A-" (377), "O+" (373) |
| `prescriptions` | `medicine` | 8 | "Atorvastatin" (973), "Lisinopril" (953), "Sertraline" (949), "Ibuprofen" (944), "Albuterol" (942) |
| `prescriptions` | `duration_days` | 28 | "28" (293), "4" (291), "23" (284), "22" (283), "16" (280) |
| `visits` | `doctor_id` | 25 | "20" (689), "14" (685), "22" (684), "21" (679), "12" (679) |
| `visits` | `dept_id` | 7 | "7" (2458), "6" (2380), "1" (2371), "4" (2363), "2" (2347) |
| `visits` | `status` | 3 | "Completed" (11036), "Cancelled" (2713), "Follow-up" (2679) |
| `wards` | `ward_id` | 8 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `wards` | `ward_name` | 8 | "Ward H" (1), "Ward G" (1), "Ward F" (1), "Ward E" (1), "Ward D" (1) |
| `wards` | `beds` | 6 | "47" (2), "22" (2), "30" (1), "28" (1), "26" (1) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `appointments` | `patient_id` | 1 | 3000 | 1494.17 | 0.0% | 0 |
| `appointments` | `doctor_id` | 1 | 25 | 12.85 | 0.0% | 0 |
| `appointments` | `appt_day` | 1 | 28 | 14.4 | 0.0% | 0 |
| `appointments` | `appt_month` | 1 | 12 | 6.5 | 0.0% | 0 |
| `appointments` | `appt_year` | 2025 | 2026 | 2025.5 | 0.0% | 0 |
| `departments` | `floor` | 1 | 5 | 2.57 | 0.0% | 0 |
| `diagnoses` | `visit_id` | 1 | 16427 | 8230.08 | 0.0% | 0 |
| `doctors` | `dept_id` | 1 | 7 | 3.76 | 0.0% | 0 |
| `doctors` | `experience_yrs` | 3 | 30 | 16.84 | 0.0% | 0 |
| `lab_tests` | `visit_id` | 1 | 16427 | 8185.85 | 0.0% | 0 |
| `patients` | `age` | 1 | 92 | 46.97 | 0.0% | 0 |
| `prescriptions` | `visit_id` | 3 | 16426 | 8226.03 | 0.0% | 0 |
| `prescriptions` | `duration_days` | 3 | 30 | 16.56 | 0.0% | 0 |
| `visits` | `patient_id` | 1 | 3000 | 1489.36 | 0.0% | 0 |
| `visits` | `doctor_id` | 1 | 25 | 13.1 | 0.0% | 0 |
| `visits` | `dept_id` | 1 | 7 | 4.02 | 0.0% | 0 |
| `visits` | `fee` | 200 | 5000 | 2580.51 | 0.0% | 0 |
| `wards` | `beds` | 20 | 47 | 30.25 | 0.0% | 0 |

---

### I1_workshop.db (industry)
- **Location**: `industry/I1_workshop.db` (128 KB)
- **Total Rows**: 3,330 across 3 tables

#### Tables & Columns (F1)
- **`dfc`** (2,824 rows): `df_id` (INTEGER, PK), `run_id` (INTEGER), `tp` (TEXT), `sv` (INTEGER)
- **`mcs`** (6 rows): `mc_id` (INTEGER, PK), `mc_nm` (TEXT), `eff` (INTEGER), `yr` (INTEGER)
- **`prod`** (500 rows): `run_id` (INTEGER, PK), `mc_id` (INTEGER), `shift` (TEXT), `run_ts` (INTEGER), `units` (INTEGER), `defs` (INTEGER), `opr` (TEXT)

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `dfc` | `tp` | 5 | "PAINT" (601), "SCRATCH" (577), "DENT" (562), "WELD" (558), "MISCUT" (526) |
| `dfc` | `sv` | 5 | "4" (591), "2" (587), "1" (563), "3" (559), "5" (524) |
| `mcs` | `mc_id` | 6 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `mcs` | `mc_nm` | 6 | "MC_006" (1), "MC_005" (1), "MC_004" (1), "MC_003" (1), "MC_002" (1) |
| `mcs` | `eff` | 5 | "79" (2), "87" (1), "83" (1), "77" (1), "62" (1) |
| `mcs` | `yr` | 6 | "2023" (1), "2021" (1), "2015" (1), "2014" (1), "2013" (1) |
| `prod` | `mc_id` | 6 | "5" (92), "4" (88), "3" (84), "1" (80), "6" (79) |
| `prod` | `shift` | 3 | "Morning" (173), "Night" (171), "Evening" (156) |
| `prod` | `defs` | 48 | "0" (150), "2" (27), "11" (26), "10" (24), "3" (24) |
| `prod` | `opr` | 6 | "ARUN" (90), "SURESH" (88), "MEERA" (85), "RAVI" (82), "ANITA" (81) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `dfc` | `run_id` | 2 | 500 | 251.16 | 0.0% | 0 |
| `dfc` | `sv` | 1 | 5 | 2.97 | 0.0% | 0 |
| `mcs` | `eff` | 62 | 87 | 77.83 | 0.0% | 0 |
| `mcs` | `yr` | 2011 | 2023 | 2016.17 | 0.0% | 0 |
| `prod` | `mc_id` | 1 | 6 | 3.54 | 0.0% | 0 |
| `prod` | `run_ts` | 1704201945 | 1735481148 | 1720474118.66 | 0.0% | 0 |
| `prod` | `units` | 50 | 1197 | 609.26 | 0.0% | 0 |
| `prod` | `defs` | 0 | 90 | 8.79 | 0.0% | 0 |

---

### I2_factory.db (industry)
- **Location**: `industry/I2_factory.db` (1676 KB)
- **Total Rows**: 51,836 across 3 tables

#### Tables & Columns (F1)
- **`defect_log`** (43,820 rows): `defect_id` (INTEGER, PK), `run_id` (INTEGER), `defect_type` (TEXT), `severity` (INTEGER)
- **`machines`** (16 rows): `machine_id` (INTEGER, PK), `machine_name` (TEXT), `efficiency_pct` (INTEGER), `install_year` (INTEGER)
- **`production_runs`** (8,000 rows): `run_id` (INTEGER, PK), `machine_id` (INTEGER), `shift` (TEXT), `run_date` (TEXT), `units_produced` (INTEGER), `units_defective` (INTEGER), `operator` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `machines` | `install_year` | **MIXED (OTHER-TEXT (2016), OTHER-TEXT (2014), OTHER-TEXT (2018), OTHER-TEXT (2017), OTHER-TEXT (2013), OTHER-TEXT (2011), OTHER-TEXT (2020), OTHER-TEXT (2021), OTHER-TEXT (2015))** | `2011` | `2021` | `2016, 2014` |
| `production_runs` | `run_date` | **ISO-TEXT (YYYY-MM-DD)** | `2024-01-01` | `2024-12-29` | `2024-09-21, 2024-12-01` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `defect_log` | `defect_type` | 5 | "MISCUT" (8885), "SCRATCH" (8824), "DENT" (8793), "PAINT" (8744), "WELD" (8574) |
| `defect_log` | `severity` | 5 | "4" (8859), "2" (8780), "1" (8766), "3" (8738), "5" (8677) |
| `machines` | `machine_id` | 16 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `machines` | `machine_name` | 8 | "Laser Cutter Pro" (2), "Injection Molder Y" (2), "Injection Molder X" (2), "Hydraulic Press One" (2), "CNC Mill Alpha" (2) |
| `machines` | `efficiency_pct` | 13 | "97" (2), "95" (2), "66" (2), "90" (1), "88" (1) |
| `machines` | `install_year` | 9 | "2013" (3), "2020" (2), "2017" (2), "2016" (2), "2014" (2) |
| `production_runs` | `machine_id` | 16 | "3" (553), "11" (542), "12" (528), "5" (521), "6" (513) |
| `production_runs` | `shift` | 3 | "Evening" (2738), "Night" (2631), "Morning" (2631) |
| `production_runs` | `operator` | 6 | "Arun Bose" (1379), "Meera Iyer" (1369), "Anita Verma" (1342), "Deepak Das" (1340), "Suresh Singh" (1332) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `defect_log` | `run_id` | 2 | 8000 | 4029.49 | 0.0% | 0 |
| `defect_log` | `severity` | 1 | 5 | 3 | 0.0% | 0 |
| `machines` | `efficiency_pct` | 61 | 97 | 79.44 | 0.0% | 0 |
| `machines` | `install_year` | 2011 | 2021 | 2015.56 | 0.0% | 0 |
| `production_runs` | `machine_id` | 1 | 16 | 8.48 | 0.0% | 0 |
| `production_runs` | `units_produced` | 50 | 1200 | 628.97 | 0.0% | 0 |
| `production_runs` | `units_defective` | 0 | 95 | 8.3 | 0.0% | 0 |

---

### I3_plantops.db (industry)
- **Location**: `industry/I3_plantops.db` (13104 KB)
- **Total Rows**: 3,88,238 across 3 tables

#### Tables & Columns (F1)
- **`defect_log`** (3,28,118 rows): `defect_id` (INTEGER, PK), `run_id` (INTEGER), `defect_type` (TEXT), `severity` (INTEGER)
- **`machines`** (120 rows): `machine_id` (INTEGER, PK), `machine_name` (TEXT), `efficiency_pct` (INTEGER), `install_year` (INTEGER)
- **`production_runs`** (60,000 rows): `run_id` (INTEGER, PK), `machine_id` (INTEGER), `shift` (TEXT), `run_date` (TEXT), `units_produced` (INTEGER), `units_defective` (INTEGER), `operator` (TEXT)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `machines` | `install_year` | **MIXED (OTHER-TEXT (2013), OTHER-TEXT (2019), OTHER-TEXT (2017), OTHER-TEXT (2016), OTHER-TEXT (2012), OTHER-TEXT (2021), OTHER-TEXT (2023), OTHER-TEXT (2020), OTHER-TEXT (2010), OTHER-TEXT (2022))** | `2010` | `2024` | `2013, 2019` |
| `production_runs` | `run_date` | **ISO-TEXT (YYYY-MM-DD)** | `2024-01-01` | `2024-12-29` | `2024-10-05, 2024-02-12` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `defect_log` | `defect_type` | 5 | "SCRATCH" (65786), "PAINT" (65772), "WELD" (65722), "DENT" (65505), "MISCUT" (65333) |
| `defect_log` | `severity` | 5 | "5" (65706), "3" (65671), "1" (65664), "4" (65651), "2" (65426) |
| `machines` | `machine_name` | 8 | "Laser Cutter Pro" (15), "Injection Molder Y" (15), "Injection Molder X" (15), "Hydraulic Press One" (15), "CNC Mill Alpha" (15) |
| `machines` | `efficiency_pct` | 38 | "86" (6), "74" (6), "65" (6), "81" (5), "76" (5) |
| `machines` | `install_year` | 15 | "2020" (14), "2015" (13), "2011" (13), "2023" (12), "2024" (9) |
| `production_runs` | `shift` | 3 | "Night" (20067), "Morning" (20040), "Evening" (19893) |
| `production_runs` | `operator` | 6 | "Deepak Das" (10207), "Meera Iyer" (10032), "Arun Bose" (9974), "Anita Verma" (9962), "Ravi Kumar" (9944) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `defect_log` | `run_id` | 1 | 60000 | 30061.19 | 0.0% | 0 |
| `defect_log` | `severity` | 1 | 5 | 3 | 0.0% | 0 |
| `machines` | `efficiency_pct` | 60 | 98 | 77.7 | 0.0% | 0 |
| `machines` | `install_year` | 2010 | 2024 | 2017.15 | 0.0% | 0 |
| `production_runs` | `machine_id` | 1 | 120 | 60.65 | 0.0% | 0 |
| `production_runs` | `units_produced` | 50 | 1200 | 626.56 | 0.0% | 0 |
| `production_runs` | `units_defective` | 0 | 96 | 8.21 | 0.0% | 0 |

---

### U1_stateuniv.db (university)
- **Location**: `university/U1_stateuniv.db` (128 KB)
- **Total Rows**: 1,823 across 5 tables

#### Tables & Columns (F1)
- **`courses`** (40 rows): `course_id` (INTEGER, PK), `course_code` (TEXT), `course_name` (TEXT), `dept_id` (INTEGER), `instructor_id` (INTEGER), `credits` (INTEGER), `capacity` (INTEGER)
- **`departments`** (8 rows): `dept_id` (INTEGER, PK), `name` (TEXT), `budget` (INTEGER)
- **`enrollments`** (1,455 rows): `enrollment_id` (INTEGER, PK), `student_id` (INTEGER), `course_id` (INTEGER), `gpa` (REAL), `semester` (TEXT)
- **`instructors`** (20 rows): `instructor_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `salary` (INTEGER), `experience_yrs` (INTEGER), `advisor_id` (INTEGER)
- **`students`** (300 rows): `student_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `year` (INTEGER), `advisor_id` (INTEGER), `gpa` (REAL)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `students` | `year` | **MIXED (OTHER-TEXT (3), OTHER-TEXT (1), OTHER-TEXT (4), OTHER-TEXT (2))** | `1` | `4` | `3, 1` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `courses` | `course_id` | 40 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `courses` | `course_code` | 40 | "PH337" (1), "PH329" (1), "PH321" (1), "PH313" (1), "PH305" (1) |
| `courses` | `course_name` | 12 | "Signal Processing" (7), "Discrete Mathematics" (5), "Operating Systems" (4), "Databases" (4), "Compiler Design" (4) |
| `courses` | `dept_id` | 8 | "7" (11), "6" (6), "2" (6), "4" (5), "1" (5) |
| `courses` | `instructor_id` | 19 | "20" (4), "4" (4), "17" (3), "10" (3), "9" (3) |
| `courses` | `credits` | 4 | "5" (11), "4" (11), "2" (10), "3" (8) |
| `courses` | `capacity` | 32 | "99" (3), "68" (3), "67" (2), "62" (2), "60" (2) |
| `departments` | `dept_id` | 8 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `departments` | `name` | 8 | "Physics" (1), "Mechanical Engineering" (1), "Mathematics" (1), "Management" (1), "Electrical Engineering" (1) |
| `departments` | `budget` | 8 | "4882935" (1), "4004156" (1), "3493688" (1), "2611906" (1), "2443867" (1) |
| `enrollments` | `course_id` | 40 | "12" (49), "28" (44), "33" (44), "40" (43), "15" (42) |
| `enrollments` | `semester` | 6 | "Spring 2023" (293), "Spring 2025" (256), "Spring 2024" (245), "Fall 2023" (228), "Fall 2025" (219) |
| `instructors` | `instructor_id` | 20 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `instructors` | `name` | 20 | "Prof. Zara Sharma" (1), "Prof. Yuki Devi" (1), "Prof. Yuki Costa" (1), "Prof. Yuki Ahmed" (1), "Prof. Viktor Okafor" (1) |
| `instructors` | `dept_id` | 8 | "7" (4), "8" (3), "5" (3), "4" (3), "6" (2) |
| `instructors` | `salary` | 20 | "172472" (1), "155810" (1), "143322" (1), "134346" (1), "133448" (1) |
| `instructors` | `experience_yrs` | 17 | "30" (2), "19" (2), "18" (2), "33" (1), "32" (1) |
| `instructors` | `advisor_id` | 7 | "18" (1), "15" (1), "12" (1), "9" (1), "6" (1) |
| `students` | `dept_id` | 8 | "1" (46), "6" (42), "3" (40), "4" (38), "5" (38) |
| `students` | `year` | 4 | "4" (79), "1" (77), "3" (72), "2" (72) |
| `students` | `advisor_id` | 20 | "20" (20), "13" (19), "8" (17), "5" (17), "17" (16) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `courses` | `dept_id` | 1 | 8 | 4.8 | 0.0% | 0 |
| `courses` | `instructor_id` | 1 | 20 | 9.82 | 0.0% | 0 |
| `courses` | `credits` | 2 | 5 | 3.58 | 0.0% | 0 |
| `courses` | `capacity` | 31 | 118 | 69.7 | 0.0% | 0 |
| `departments` | `budget` | 626437 | 4882935 | 2638952.75 | 0.0% | 0 |
| `enrollments` | `student_id` | 1 | 300 | 152 | 0.0% | 0 |
| `enrollments` | `course_id` | 1 | 40 | 20.67 | 0.0% | 0 |
| `enrollments` | `gpa` | 0 | 4 | 2 | 0.0% | 0 |
| `instructors` | `dept_id` | 1 | 8 | 5.05 | 0.0% | 0 |
| `instructors` | `salary` | 42663 | 172472 | 93150.4 | 0.0% | 0 |
| `instructors` | `experience_yrs` | 1 | 33 | 19.55 | 0.0% | 0 |
| `instructors` | `advisor_id` | 1 | 18 | 9.29 | 65.0% | 0 |
| `students` | `dept_id` | 1 | 8 | 4.4 | 0.0% | 0 |
| `students` | `year` | 1 | 4 | 2.51 | 0.0% | 0 |
| `students` | `advisor_id` | 1 | 20 | 10.78 | 10.7% | 0 |
| `students` | `gpa` | 0.03 | 3.98 | 2.06 | 0.0% | 0 |

---

### U2_metrouniv.db (university)
- **Location**: `university/U2_metrouniv.db` (912 KB)
- **Total Rows**: 17,911 across 5 tables

#### Tables & Columns (F1)
- **`courses`** (120 rows): `course_id` (INTEGER, PK), `course_code` (TEXT), `course_name` (TEXT), `dept_id` (INTEGER), `instructor_id` (INTEGER), `credits` (INTEGER), `capacity` (INTEGER)
- **`departments`** (8 rows): `dept_id` (INTEGER, PK), `name` (TEXT), `budget` (INTEGER)
- **`enrollments`** (14,708 rows): `enrollment_id` (INTEGER, PK), `student_id` (INTEGER), `course_id` (INTEGER), `gpa` (REAL), `semester` (TEXT)
- **`instructors`** (75 rows): `instructor_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `salary` (INTEGER), `experience_yrs` (INTEGER), `advisor_id` (INTEGER)
- **`students`** (3,000 rows): `student_id` (INTEGER, PK), `name` (TEXT), `dept_id` (INTEGER), `year` (INTEGER), `advisor_id` (INTEGER), `gpa` (REAL)

#### Date Storage Reality (F2)
| Table | Column | Storage Class | Min | Max | Sample |
|---|---|---|---|---|---|
| `students` | `year` | **MIXED (OTHER-TEXT (3), OTHER-TEXT (1), OTHER-TEXT (2), OTHER-TEXT (4))** | `1` | `4` | `3, 1` |

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `courses` | `course_name` | 12 | "Machine Learning" (15), "Fluid Mechanics" (14), "Operating Systems" (13), "Structural Analysis" (11), "Discrete Mathematics" (11) |
| `courses` | `dept_id` | 8 | "6" (25), "2" (22), "3" (17), "4" (14), "8" (13) |
| `courses` | `credits` | 4 | "2" (39), "4" (32), "5" (27), "3" (22) |
| `departments` | `dept_id` | 8 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `departments` | `name` | 8 | "Physics" (1), "Mechanical Engineering" (1), "Mathematics" (1), "Management" (1), "Electrical Engineering" (1) |
| `departments` | `budget` | 8 | "4795922" (1), "4540784" (1), "4159399" (1), "3761208" (1), "3298170" (1) |
| `enrollments` | `semester` | 6 | "Spring 2025" (2514), "Fall 2024" (2466), "Spring 2024" (2460), "Fall 2023" (2430), "Fall 2025" (2420) |
| `instructors` | `dept_id` | 8 | "5" (14), "7" (12), "6" (11), "8" (9), "4" (8) |
| `instructors` | `experience_yrs` | 31 | "20" (6), "25" (5), "33" (4), "32" (4), "31" (4) |
| `instructors` | `advisor_id` | 25 | "75" (1), "72" (1), "69" (1), "66" (1), "63" (1) |
| `students` | `dept_id` | 8 | "3" (398), "1" (392), "8" (387), "6" (379), "5" (373) |
| `students` | `year` | 4 | "1" (763), "3" (757), "4" (740), "2" (740) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `courses` | `dept_id` | 1 | 8 | 4.42 | 0.0% | 0 |
| `courses` | `instructor_id` | 1 | 75 | 39.11 | 0.0% | 0 |
| `courses` | `credits` | 2 | 5 | 3.39 | 0.0% | 0 |
| `courses` | `capacity` | 31 | 119 | 73.24 | 0.0% | 0 |
| `departments` | `budget` | 606848 | 4795922 | 3348829.5 | 0.0% | 0 |
| `enrollments` | `student_id` | 1 | 3000 | 1502.14 | 0.0% | 0 |
| `enrollments` | `course_id` | 1 | 120 | 60.45 | 0.0% | 0 |
| `enrollments` | `gpa` | 0 | 4 | 1.99 | 0.0% | 0 |
| `instructors` | `dept_id` | 1 | 8 | 4.89 | 0.0% | 0 |
| `instructors` | `salary` | 40064 | 177157 | 113100.57 | 0.0% | 0 |
| `instructors` | `experience_yrs` | 1 | 35 | 19.4 | 0.0% | 0 |
| `instructors` | `advisor_id` | 3 | 75 | 39 | 66.7% | 0 |
| `students` | `dept_id` | 1 | 8 | 4.5 | 0.0% | 0 |
| `students` | `year` | 1 | 4 | 2.49 | 0.0% | 0 |
| `students` | `advisor_id` | 1 | 75 | 38.32 | 11.2% | 0 |
| `students` | `gpa` | 0 | 4 | 1.97 | 0.0% | 0 |

---

### U3_institute.db (university)
- **Location**: `university/U3_institute.db` (2828 KB)
- **Total Rows**: 72,096 across 5 tables

#### Tables & Columns (F1)
- **`crss`** (300 rows): `crs_id` (INTEGER, PK), `crs_cd` (TEXT), `crs_nm` (TEXT), `dept_id` (INTEGER), `prof_id` (INTEGER), `cred` (INTEGER), `cap` (INTEGER)
- **`depts`** (8 rows): `dept_id` (INTEGER, PK), `dept_nm` (TEXT), `bud` (INTEGER)
- **`enrs`** (59,488 rows): `enr_id` (INTEGER, PK), `stu_id` (INTEGER), `crs_id` (INTEGER), `grade` (TEXT), `sem` (TEXT)
- **`profs`** (300 rows): `prof_id` (INTEGER, PK), `prof_nm` (TEXT), `dept_id` (INTEGER), `sal` (INTEGER), `yrs` (INTEGER), `adv_id` (INTEGER)
- **`stus`** (12,000 rows): `stu_id` (INTEGER, PK), `stu_nm` (TEXT), `dept_id` (INTEGER), `yr` (INTEGER), `adv_id` (INTEGER)

#### Categorical Dimensions (F3: 2–50 distinct)
| Table | Column | Distinct Count | Top 5 Verbatim Values |
|---|---|---:|---|
| `crss` | `dept_id` | 8 | "5" (47), "7" (44), "2" (42), "8" (35), "3" (34) |
| `crss` | `cred` | 4 | "4" (84), "5" (80), "2" (69), "3" (67) |
| `depts` | `dept_id` | 8 | "1" (1), "2" (1), "3" (1), "4" (1), "5" (1) |
| `depts` | `dept_nm` | 8 | "DEP_08" (1), "DEP_07" (1), "DEP_06" (1), "DEP_05" (1), "DEP_04" (1) |
| `depts` | `bud` | 8 | "4939634" (1), "4175961" (1), "3764454" (1), "3076433" (1), "2893538" (1) |
| `enrs` | `grade` | 11 | "B" (5541), "C+" (5499), "A" (5472), "A+" (5467), "F" (5428) |
| `enrs` | `sem` | 6 | "20231" (10012), "20241" (9978), "20252" (9928), "20242" (9910), "20232" (9884) |
| `profs` | `dept_id` | 8 | "2" (50), "5" (43), "1" (38), "8" (35), "7" (35) |
| `profs` | `yrs` | 35 | "33" (19), "25" (14), "21" (12), "31" (11), "30" (11) |
| `stus` | `dept_id` | 8 | "8" (1529), "5" (1524), "4" (1518), "1" (1507), "3" (1503) |
| `stus` | `yr` | 4 | "4" (3036), "3" (3017), "1" (3000), "2" (2947) |

#### Numeric Columns Profile (F4)
| Table | Column | Min | Max | Avg | Null Rate | Negative Values |
|---|---|---:|---:|---:|---:|---:|
| `crss` | `dept_id` | 1 | 8 | 4.54 | 0.0% | 0 |
| `crss` | `prof_id` | 2 | 300 | 153.52 | 0.0% | 0 |
| `crss` | `cred` | 2 | 5 | 3.58 | 0.0% | 0 |
| `crss` | `cap` | 30 | 120 | 74.56 | 0.0% | 0 |
| `depts` | `bud` | 1631418 | 4939634 | 3112865.38 | 0.0% | 0 |
| `enrs` | `stu_id` | 1 | 12000 | 5991.87 | 0.0% | 0 |
| `enrs` | `crs_id` | 1 | 300 | 150.73 | 0.0% | 0 |
| `profs` | `dept_id` | 1 | 8 | 4.37 | 0.0% | 0 |
| `profs` | `sal` | 40268 | 179648 | 107003.59 | 0.0% | 0 |
| `profs` | `yrs` | 1 | 35 | 18.59 | 0.0% | 0 |
| `profs` | `adv_id` | 3 | 300 | 151.5 | 66.7% | 0 |
| `stus` | `dept_id` | 1 | 8 | 4.51 | 0.0% | 0 |
| `stus` | `yr` | 1 | 4 | 2.51 | 0.0% | 0 |
| `stus` | `adv_id` | 1 | 300 | 150.82 | 12.1% | 0 |

---

## Self-Audit Checklist

- [x] **15/15 DBs Profiled**: All 15 database fixtures profiled without silent skips.
- [x] **Verbatim Identifiers**: Table names (`dx`, `rst`, `mcs`, `dfc`, `accts`, etc.) and columns copied verbatim.
- [x] **F5 Cross-Check Table**: Declared foreign keys cross-checked against naming heuristic for all DBs.
- [x] **F6 Schema Diffs**: Domain trio schema evolutions documented for bank, fooddelivery, hospital, industry, university.
- [x] **F7 Generatability Matrix**: Complete 15 × 12 matrix; every SKIP has an explicit reason code.
- [x] **fitcheck.json Validation**: Machine-readable specification verified with `JSON.parse`.
