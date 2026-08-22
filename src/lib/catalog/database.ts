import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATABASE_PATH =
  process.env.MODEL_CATALOG_DB_PATH ?? path.join(DATA_DIRECTORY, "catalog.db");

declare global {
  var __modelCatalogDatabase: BetterSqlite3.Database | undefined;
}

function ensureColumn(
  database: BetterSqlite3.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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
      developer_country TEXT,
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
      currency TEXT,
      price_unit TEXT,
      price_status TEXT NOT NULL DEFAULT 'unknown',
      is_official_api INTEGER NOT NULL DEFAULT 0,
      market TEXT,
      price_note TEXT,
      verified_at TEXT,
      pricing_tiers_json TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS provider_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      country TEXT NOT NULL,
      developer_ids_json TEXT NOT NULL DEFAULT '[]',
      homepage_url TEXT,
      pricing_url TEXT,
      api_status TEXT NOT NULL,
      price_status TEXT NOT NULL,
      notes TEXT,
      verified_at TEXT,
      updated_at TEXT NOT NULL
    );

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

  ensureColumn(database, "canonical_models", "developer_country", "TEXT");
  ensureColumn(database, "offerings", "currency", "TEXT");
  ensureColumn(database, "offerings", "price_unit", "TEXT");
  ensureColumn(
    database,
    "offerings",
    "price_status",
    "TEXT NOT NULL DEFAULT 'unknown'",
  );
  ensureColumn(
    database,
    "offerings",
    "is_official_api",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(database, "offerings", "market", "TEXT");
  ensureColumn(database, "offerings", "price_note", "TEXT");
  ensureColumn(database, "offerings", "verified_at", "TEXT");
  ensureColumn(
    database,
    "offerings",
    "pricing_tiers_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_offerings_official_price
      ON offerings(canonical_model_id, is_official_api, market, price_status, active);
    CREATE INDEX IF NOT EXISTS idx_provider_sources_country
      ON provider_sources(country, price_status);
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
