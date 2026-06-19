import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import log from 'electron-log'

function resolveUserDataPath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData')
    }
  } catch {
    // ignore and use fallback
  }

  // Fallback for non-Electron contexts (unit tests/node runtime)
  return process.env['MULBY_USER_DATA_PATH'] || join(process.cwd(), '.mulby-user-data')
}

const DB_DIR = join(resolveUserDataPath(), 'db')
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

// ====== Schema 版本迁移 ======
const LATEST_SCHEMA_VERSION = 1
const currentSchemaVersion = (db.pragma('user_version') as { user_version: number }[])[0]?.user_version ?? 0

if (currentSchemaVersion < 1) {
  // v1: 增加 version 列（CAS 乐观并发控制）+ 前缀查询索引
  db.exec(`
    ALTER TABLE store ADD COLUMN version INTEGER DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_store_plugin_key_prefix ON store(plugin_id, key);
  `)
  db.pragma(`user_version = ${LATEST_SCHEMA_VERSION}`)
  log.info('[DB] Schema 迁移完成: v0 → v1 (增加 version 列)')
}

/**
 * 关闭数据库连接。仅用于「插件验证模式」退出前释放 SQLite 文件锁，
 * 以便随后删除隔离的临时 userData 目录。正常运行流程不会调用。
 */
export function closeDatabase(): void {
  try {
    db.close()
  } catch {
    /* 已关闭或无法关闭时忽略 */
  }
}

export default db
