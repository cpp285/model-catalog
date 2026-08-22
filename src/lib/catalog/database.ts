import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATABASE_PATH =
  process.env.MODEL_CATALOG_DB_PATH ?? path.join(DATA_DIRECTORY, "catalog.db");

declare global {
  var __modelCatalogDatabase: BetterSqlite3.Database | undefined;
}

function createDatabase() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });

  const database = new BetterSqlite3(DATABASE_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  database.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      counts_json TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS canonical_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      developer TEXT NOT NULL,
      family TEXT,
      description TEXT,
      release_date TEXT,
      knowledge_cutoff TEXT,
      last_updated TEXT,
      context_window INTEGER,
      max_output INTEGER,
      input_modalities TEXT NOT NULL DEFAULT '[]',
      output_modalities TEXT NOT NULL DEFAULT '[]',
      reasoning INTEGER,
      tool_call INTEGER,
      structured_output INTEGER,
      attachment INTEGER,
      open_weights INTEGER,
      benchmarks_json TEXT NOT NULL DEFAULT '[]',
      weights_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offerings (
      uid TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_model_id TEXT NOT NULL,
      canonical_model_id TEXT,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      name TEXT NOT NULL,
      developer TEXT NOT NULL,
      family TEXT,
      description TEXT,
      mode TEXT,
      input_modalities TEXT NOT NULL DEFAULT '[]',
      output_modalities TEXT NOT NULL DEFAULT '[]',
      context_window INTEGER,
      max_input INTEGER,
      max_output INTEGER,
      input_price REAL,
      output_price REAL,
      cache_read_price REAL,
      cache_write_price REAL,
      reasoning INTEGER,
      tool_call INTEGER,
      structured_output INTEGER,
      open_weights INTEGER,
      release_date TEXT,
      deprecation_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      match_confidence REAL NOT NULL DEFAULT 0,
      source_url TEXT,
      raw_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (canonical_model_id) REFERENCES canonical_models(id)
    );

    CREATE INDEX IF NOT EXISTS idx_offerings_canonical
      ON offerings(canonical_model_id);
    CREATE INDEX IF NOT EXISTS idx_offerings_source
      ON offerings(source, active);
    CREATE INDEX IF NOT EXISTS idx_offerings_provider
      ON offerings(provider_id, active);
    CREATE INDEX IF NOT EXISTS idx_offerings_match
      ON offerings(match_status, active);

    CREATE TABLE IF NOT EXISTS user_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#d97745',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_user_tags (
      model_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (model_id, tag_id),
      FOREIGN KEY (model_id) REFERENCES canonical_models(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES user_tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS manual_aliases (
      source TEXT NOT NULL,
      source_model_id TEXT NOT NULL,
      canonical_model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source, source_model_id),
      FOREIGN KEY (canonical_model_id) REFERENCES canonical_models(id)
    );
  `);

  return database;
}

export function getDatabase() {
  if (!globalThis.__modelCatalogDatabase) {
    globalThis.__modelCatalogDatabase = createDatabase();
  }

  return globalThis.__modelCatalogDatabase;
}

export function getDataDirectory() {
  return DATA_DIRECTORY;
}
