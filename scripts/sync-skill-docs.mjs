#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const srcDir = path.join(root, 'docs/apis')

// 只同步到 skills 目录下
const targetDirs = [
  path.join(root, 'skills/develop-mulby-plugin/references/apis')
]

console.log('Syncing API docs to skill references...')

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'))

for (const target of targetDirs) {
  if (!fs.existsSync(target)) {
    continue
  }
  
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(target, file))
  }
  console.log(`Synced ${files.length} files to ${path.relative(root, target)}`)

  // bump 所属 skill 的 SKILL.md mtime：link-skills.sh 按 SKILL.md 的 mtime 判断是否重新复制，
  // 否则仅更新 references/apis 文档（未改 SKILL.md）时不会真正同步到各 IDE。
  const skillRoot = path.dirname(path.dirname(target))
  const skillMd = path.join(skillRoot, 'SKILL.md')
  if (fs.existsSync(skillMd)) {
    const now = new Date()
    fs.utimesSync(skillMd, now, now)
    console.log(`Touched ${path.relative(root, skillMd)} (so link-skills.sh re-syncs doc-only changes)`)
  }
}

console.log('Skill docs sync complete.')
