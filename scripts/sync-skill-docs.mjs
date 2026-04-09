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
}

console.log('Skill docs sync complete.')
