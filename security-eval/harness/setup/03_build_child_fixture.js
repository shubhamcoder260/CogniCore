'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/**
 * Builds the child-table project database (child_projects.sqlite) per O11 and Decision D-04.
 * Schema:
 *   projects (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)
 *   tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), task_name TEXT NOT NULL)
 *
 * Evaluates transitive isolation (H2-B) where child table lacks a direct tenant_id column.
 */
function buildChildFixture(targetDbPath, opts = {}) {
  if (opts.dryRun) {
    return { dryRun: true, targetDbPath };
  }

  const outDir = path.dirname(targetDbPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (fs.existsSync(targetDbPath)) {
    fs.unlinkSync(targetDbPath);
  }

  const db = new Database(targetDbPath);
  db.pragma('foreign_keys = ON');

  db.exec(`
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS projects;

    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      task_name TEXT NOT NULL
    );
  `);

  // Seed projects for Tenant A and Tenant B
  const insertProject = db.prepare('INSERT INTO projects (tenant_id, name) VALUES (?, ?)');
  const p1 = insertProject.run('tenant_a', 'Project Apollo (Tenant A)').lastInsertRowid;
  const p2 = insertProject.run('tenant_a', 'Project Orion (Tenant A)').lastInsertRowid;
  const p3 = insertProject.run('tenant_b', 'Project Hermes (Tenant B)').lastInsertRowid;

  // Seed tasks referencing projects
  const insertTask = db.prepare('INSERT INTO tasks (project_id, task_name) VALUES (?, ?)');
  insertTask.run(p1, 'Apollo Payload Specs [CANARY_TENANT_A_TASK_1]');
  insertTask.run(p1, 'Apollo Fuel Architecture [CANARY_TENANT_A_TASK_2]');
  insertTask.run(p2, 'Orion Heat Shield Calibration');
  insertTask.run(p3, 'Hermes Courier Delivery System');

  const projectCount = db.prepare('SELECT count(*) as count FROM projects').get().count;
  const taskCount = db.prepare('SELECT count(*) as count FROM tasks').get().count;

  db.close();

  return {
    success: true,
    targetDbPath,
    projectCount,
    taskCount,
    schema: {
      projects: ['id', 'tenant_id', 'name'],
      tasks: ['id', 'project_id', 'task_name'],
    },
  };
}

if (require.main === module) {
  const target = path.resolve(__dirname, '../../data/fixtures/child_projects.sqlite');
  const result = buildChildFixture(target);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { buildChildFixture };
