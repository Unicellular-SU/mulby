import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

const DB_DIR = join(app.getPath('userData'), 'db')
const DB_PATH = join(DB_DIR, 'storage.db')

// 确保数据库目录存在
if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true })
}

// 初始化数据库
const db = new Database(DB_PATH)

// 启用 WAL 模式以提高并发性能
db.pragma('journal_mode = WAL')

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS store (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at INTEGER,
    PRIMARY KEY (plugin_id, key)
  );
  
  CREATE INDEX IF NOT EXISTS idx_store_plugin_id ON store(plugin_id);
`)

export default db
