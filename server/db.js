// SQLite database (Node's built-in node:sqlite, no native modules). One file.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = [`
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  report_recipients TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','tester','viewer')),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE template_items (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  area TEXT NOT NULL,
  group_name TEXT NOT NULL,
  title TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  auto INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  area TEXT NOT NULL,
  group_name TEXT NOT NULL,
  title TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  auto INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, code)
);
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'staging',
  base_url TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
-- one row per task per round: a snapshot of the task plus its result
CREATE TABLE run_items (
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id INTEGER,
  code TEXT NOT NULL,
  area TEXT NOT NULL,
  group_name TEXT NOT NULL,
  title TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Not tested' CHECK (status IN ('Not tested','Pass','Fail','Blocked','Not applicable')),
  notes TEXT NOT NULL DEFAULT '',
  tester_id INTEGER REFERENCES users(id),
  source TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY (run_id, code)
);
CREATE TABLE result_history (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  by_user INTEGER,
  by_source TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bugs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'major' CHECK (severity IN ('critical','major','minor','trivial')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','fixed','verified','wontfix')),
  description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  actual TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  task_code TEXT NOT NULL DEFAULT '',
  run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  reporter_id INTEGER REFERENCES users(id),
  assignee_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, code)
);
CREATE TABLE bug_events (
  id INTEGER PRIMARY KEY,
  bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  by_user INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE run_item_bugs (
  run_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, code, bug_id)
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_runs_project ON runs(project_id);
CREATE INDEX idx_bugs_project ON bugs(project_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
`, `
CREATE TABLE deployments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  developer TEXT NOT NULL DEFAULT '',
  branch_type TEXT NOT NULL DEFAULT 'feature',
  staging_deploy TEXT NOT NULL DEFAULT 'pending',
  staging_test TEXT NOT NULL DEFAULT 'pending',
  live_deploy TEXT NOT NULL DEFAULT 'pending',
  live_test TEXT NOT NULL DEFAULT 'pending',
  final_status TEXT NOT NULL DEFAULT 'pending',
  staging_result TEXT NOT NULL DEFAULT '',
  live_result TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deployments_project ON deployments(project_id);
CREATE TABLE project_members_v2 (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','tester','viewer')),
  PRIMARY KEY (project_id, user_id)
);
INSERT INTO project_members_v2 (project_id, user_id, role) SELECT project_id, user_id, role FROM project_members;
DROP TABLE project_members;
ALTER TABLE project_members_v2 RENAME TO project_members;
`]

export function openDb(file = process.env.DATABASE_FILE || './data/qa-hub.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  let v = db.prepare('PRAGMA user_version').get().user_version
  while (v < SCHEMA.length) {
    db.exec('BEGIN')
    try { db.exec(SCHEMA[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
    v++
  }
  return db
}

// run fn inside a transaction
export function tx(db, fn) {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}
