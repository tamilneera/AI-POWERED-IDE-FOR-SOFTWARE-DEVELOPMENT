import Database from 'better-sqlite3';

const db = new Database('database.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    file_path TEXT NOT NULL,
    language TEXT,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS analysis_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER,
    complexity_score REAL,
    duplication_pct REAL,
    issues_json TEXT,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id)
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    file_id INTEGER,
    prompt TEXT,
    ai_response TEXT,
    model_used TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  theme TEXT DEFAULT 'dark',
  font_size INTEGER DEFAULT 14,
  word_wrap INTEGER DEFAULT 0,
  tab_size INTEGER DEFAULT 2,
  minimap INTEGER DEFAULT 1,
  shortcuts_json TEXT DEFAULT '{}'
);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT
  );

INSERT OR IGNORE INTO settings (id, theme, font_size, shortcuts_json)
VALUES (1, 'dark', 14, '{}');

`);

console.log('Database connected and tables ready.');

// One-time migration: add new columns if they don't exist yet (safe to leave in permanently)
const settingsColumns = db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
const columnNames = settingsColumns.map(c => c.name);
if (!columnNames.includes('word_wrap')) {
  db.exec("ALTER TABLE settings ADD COLUMN word_wrap INTEGER DEFAULT 0");
}
if (!columnNames.includes('tab_size')) {
  db.exec("ALTER TABLE settings ADD COLUMN tab_size INTEGER DEFAULT 2");
}
if (!columnNames.includes('minimap')) {
  db.exec("ALTER TABLE settings ADD COLUMN minimap INTEGER DEFAULT 1");
}

export default db;