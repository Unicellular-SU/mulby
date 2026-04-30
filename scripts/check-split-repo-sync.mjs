#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()

function rel(...parts) {
  return path.join(root, ...parts)
}

function fail(message) {
  console.error(`[split-sync] ${message}`)
  process.exitCode = 1
}

function run(label, command, args, options = {}) {
  console.log(`[split-sync] ${label}`)
  const child = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options
  })

  if (child.error) {
    throw child.error
  }

  if (child.status !== 0) {
    fail(`${label} failed with exit code ${child.status}`)
  }
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right))
}

function compareApiDocs() {
  const sourceDir = rel('docs', 'apis')
  const targetDir = rel('skills', 'develop-mulby-plugin', 'references', 'apis')

  console.log('[split-sync] Checking skills API docs copy')

  if (!fs.existsSync(targetDir)) {
    fail(
      `missing local skills docs directory: ${path.relative(root, targetDir)}\n` +
      '  Clone https://github.com/Unicellular-SU/mulby-skills.git to ./skills first.'
    )
    return
  }

  const sourceFiles = listMarkdownFiles(sourceDir)
  for (const file of sourceFiles) {
    const sourcePath = path.join(sourceDir, file)
    const targetPath = path.join(targetDir, file)
    const targetExists = fs.existsSync(targetPath)

    if (!targetExists) {
      fail(`missing skills API doc: ${path.relative(root, targetPath)}`)
      continue
    }

    const sourceText = fs.readFileSync(sourcePath, 'utf8')
    const targetText = fs.readFileSync(targetPath, 'utf8')
    if (sourceText !== targetText) {
      fail(
        `out-of-sync API doc: ${file}\n` +
        '  Run pnpm run sync:api-docs, then commit/push the skills repository.'
      )
    }
  }
}

function checkLocalCliRepo() {
  const cliScript = rel('packages', 'mulby-cli', 'scripts', 'check-template-api-sync.mjs')
  if (!fs.existsSync(cliScript)) {
    fail(
      `missing local CLI sync checker: ${path.relative(root, cliScript)}\n` +
      '  Clone https://github.com/Unicellular-SU/mulby-cli.git to ./packages/mulby-cli first.'
    )
    return false
  }
  return true
}

run('Checking app API docs against app code', process.execPath, [rel('scripts', 'check-api-docs.mjs')])
compareApiDocs()

if (checkLocalCliRepo()) {
  run('Checking CLI template API declarations against app code', process.execPath, [
    rel('packages', 'mulby-cli', 'scripts', 'check-template-api-sync.mjs')
  ])
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log('[split-sync] All split repository sync checks passed.')
