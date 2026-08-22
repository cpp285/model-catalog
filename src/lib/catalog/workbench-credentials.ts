import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDirectory, getDatabase } from "./database";

const SECRET_DIRECTORY = path.join(getDataDirectory(), ".secrets");
const KEY_PATH = path.join(SECRET_DIRECTORY, "workbench-credentials.key");

function getCredentialDatabase() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS workbench_credentials (
      model_uid TEXT PRIMARY KEY,
      encrypted_api_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return database;
}

function getEncryptionKey() {
  fs.mkdirSync(SECRET_DIRECTORY, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(KEY_PATH)) {
    try {
      fs.writeFileSync(KEY_PATH, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  const key = fs.readFileSync(KEY_PATH);
  if (key.length !== 32) throw new Error("本机密钥文件无效，请检查 data/.secrets 目录。");
  return key;
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("已保存的 API Key 数据无效。");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function saveWorkbenchCredential(modelUid: string, apiKey: string) {
  const now = new Date().toISOString();
  getCredentialDatabase()
    .prepare(`
      INSERT INTO workbench_credentials (
        model_uid, encrypted_api_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(model_uid) DO UPDATE SET
        encrypted_api_key = excluded.encrypted_api_key,
        updated_at = excluded.updated_at
    `)
    .run(modelUid, encrypt(apiKey), now, now);
}

export function getWorkbenchCredential(modelUid: string) {
  const row = getCredentialDatabase()
    .prepare("SELECT encrypted_api_key FROM workbench_credentials WHERE model_uid = ?")
    .get(modelUid) as { encrypted_api_key: string } | undefined;
  return row ? decrypt(row.encrypted_api_key) : null;
}

export function deleteWorkbenchCredential(modelUid: string) {
  return getCredentialDatabase()
    .prepare("DELETE FROM workbench_credentials WHERE model_uid = ?")
    .run(modelUid).changes > 0;
}

export function getWorkbenchCredentialStatuses(modelUids: string[]) {
  if (!modelUids.length) return {} as Record<string, boolean>;
  const placeholders = modelUids.map(() => "?").join(",");
  const rows = getCredentialDatabase()
    .prepare(`SELECT model_uid FROM workbench_credentials WHERE model_uid IN (${placeholders})`)
    .all(...modelUids) as Array<{ model_uid: string }>;
  const configured = new Set(rows.map((row) => row.model_uid));
  return Object.fromEntries(modelUids.map((uid) => [uid, configured.has(uid)]));
}
