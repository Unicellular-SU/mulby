#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--spec') {
      out.spec = argv[i + 1]
      i += 1
    }
  }
  return out
}

function loadSharp() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const roots = [
    process.env.ELECTRON_ICON_SHARP_ROOT,
    process.cwd(),
    path.resolve(scriptDir, '..', '..', '..'),
  ].filter(Boolean)

  for (const root of roots) {
    try {
      const req = createRequire(path.join(root, 'package.json'))
      return req('sharp')
    } catch {}
    try {
      const req = createRequire(path.join(root, 'noop.js'))
      return req('sharp')
    } catch {}
  }

  try {
    const req = createRequire(import.meta.url)
    return req('sharp')
  } catch {
    throw new Error('Unable to resolve the "sharp" module. Install it in the target Node project and rerun.')
  }
}

function parseHexColor(input) {
  const value = input.replace('#', '').trim()
  if (value.length !== 6) {
    throw new Error(`Unsupported color "${input}". Use a 6-digit hex value such as #000000.`)
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function findAlphaBounds(data, info) {
  const channels = info.channels
  const alphaIndex = channels - 1
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = ((y * info.width) + x) * channels
      if (data[offset + alphaIndex] === 0) {
        continue
      }
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  return {
    left: minX,
    top: minY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  }
}

async function renderJob(sharp, job) {
  const size = Number(job.size)
  const padding = Number(job.padding ?? 0)
  const inner = Math.max(1, Math.round(size * (1 - (padding * 2))))
  const border = size - inner
  const density = Number(job.density ?? 1024)
  const top = Math.floor(border / 2)
  const bottom = border - top
  const left = Math.floor(border / 2)
  const right = border - left

  const raster = sharp(job.source, { density }).ensureAlpha()
  const { data: rasterData, info: rasterInfo } = await raster.raw().toBuffer({ resolveWithObject: true })
  const bounds = findAlphaBounds(rasterData, rasterInfo)

  let pipeline = sharp(rasterData, { raw: rasterInfo })

  if (bounds) {
    pipeline = pipeline.extract(bounds)
  }

  pipeline = pipeline.resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()

  if (job.mode === 'monochrome') {
    const color = parseHexColor(job.color ?? '#000000')
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index + 3] === 0) {
        continue
      }
      data[index] = color.r
      data[index + 1] = color.g
      data[index + 2] = color.b
    }
    pipeline = sharp(data, { raw: info })
  }

  pipeline = pipeline.extend({
    top,
    bottom,
    left,
    right,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png()

  if (job.dpi) {
    pipeline = pipeline.withMetadata({ density: Number(job.dpi) })
  }

  await mkdir(path.dirname(job.output), { recursive: true })
  await pipeline.toFile(job.output)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.spec) {
    throw new Error('Usage: render_svg_variants.mjs --spec <spec.json>')
  }

  const sharp = loadSharp()
  const spec = JSON.parse(await readFile(args.spec, 'utf8'))
  for (const job of spec.jobs ?? []) {
    await renderJob(sharp, job)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
