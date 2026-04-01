import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { AiToolContext } from '../../../shared/types/ai'
import type { AiToolingSettings } from '../../../shared/types/settings'
import type { RunCommandContext, RunCommandInput, RunCommandResult } from '../../services/command-runner'
import { normalizeFailedRunCommandResult } from './run-command-tool'
import {
  AI_ACTIVATE_SKILL_TOOL_NAME,
  AI_APPLY_PATCH_TOOL_NAME,
  AI_GIT_DIFF_TOOL_NAME,
  AI_GIT_STATUS_TOOL_NAME,
  AI_HTTP_FETCH_TOOL_NAME,
  AI_LIST_DIR_TOOL_NAME,
  AI_READ_FILE_TOOL_NAME,
  AI_RUN_SCRIPT_TOOL_NAME,
  AI_SEARCH_TEXT_TOOL_NAME,
  AI_WEB_SEARCH_TOOL_NAME,
  AI_WEB_FETCH_TOOL_NAME,
  type AiInternalToolName
} from './internal-tools'
import { WebSearchService } from './web-search-service'

const PATCH_DRY_RUN_TTL_MS = 10 * 60 * 1000

interface PatchDryRunRecord {
  hash: string
  baseDir: string
  expiresAt: number
}

const patchDryRunCache = new Map<string, PatchDryRunRecord>()

interface InternalToolRuntimeDeps {
  getToolingSettings: () => AiToolingSettings
  runCommand: (input: RunCommandInput, context: RunCommandContext) => Promise<RunCommandResult>
  resolveRunCommandContext: (context?: AiToolContext) => RunCommandContext
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeStringArray(input: unknown, maxItems = 200): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    const value = String(item ?? '')
    out.push(value)
    if (out.length >= maxItems) break
  }
  return out
}

function parseObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tool args must be an object')
  }
  return input as Record<string, unknown>
}

function parseOptionalNumber(value: unknown): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
}

function pathInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  if (process.platform === 'win32') {
    const rootLower = normalizedRoot.toLowerCase()
    const targetLower = normalizedTarget.toLowerCase()
    return targetLower === rootLower || targetLower.startsWith(`${rootLower}${path.sep}`)
  }
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function ensurePathAllowed(targetPath: string, roots: string[], label: string): string {
  const resolved = path.resolve(targetPath)
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error(`${label} policy has no allowed roots configured`)
  }
  const allowed = roots.map((item) => path.resolve(item))
  if (!allowed.some((root) => pathInside(root, resolved))) {
    throw new Error(`${label} path is outside allowed roots: ${resolved}`)
  }
  return resolved
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((segment) => segment.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

function summarizePatchFiles(patchText: string): string[] {
  const lines = String(patchText || '').split(/\r?\n/)
  const out = new Set<string>()
  for (const line of lines) {
    if (!line.startsWith('+++ ')) continue
    const raw = line.slice(4).trim()
    if (!raw || raw === '/dev/null') continue
    const normalized = raw.replace(/^b\//, '').replace(/^a\//, '')
    if (normalized) out.add(normalized)
  }
  return Array.from(out)
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function prunePatchDryRunCache(now: number): void {
  for (const [token, record] of patchDryRunCache.entries()) {
    if (record.expiresAt <= now) patchDryRunCache.delete(token)
  }
}

function toHeaderObject(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  }
  return out
}

function buildBlockList(cidrs: string[]): BlockList {
  const blockList = new BlockList()
  for (const cidr of cidrs) {
    const value = String(cidr || '').trim()
    if (!value) continue
    const slash = value.indexOf('/')
    if (slash < 0) {
      const version = isIP(value)
      if (version === 4) blockList.addAddress(value, 'ipv4')
      if (version === 6) blockList.addAddress(value, 'ipv6')
      continue
    }
    const address = value.slice(0, slash).trim()
    const prefix = Number(value.slice(slash + 1))
    const version = isIP(address)
    if (!Number.isFinite(prefix) || prefix < 0) continue
    if (version === 4 && prefix <= 32) {
      blockList.addSubnet(address, prefix, 'ipv4')
    }
    if (version === 6 && prefix <= 128) {
      blockList.addSubnet(address, prefix, 'ipv6')
    }
  }
  return blockList
}

async function collectResolvedIps(hostname: string): Promise<string[]> {
  const version = isIP(hostname)
  if (version > 0) return [hostname]
  const resolved = await lookup(hostname, { all: true })
  return resolved.map((item) => item.address)
}

function isHostDenied(hostname: string, denyHosts: string[]): boolean {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host) return false
  return denyHosts.some((candidateRaw) => {
    const candidate = String(candidateRaw || '').trim().toLowerCase()
    if (!candidate) return false
    return host === candidate || host.endsWith(`.${candidate}`)
  })
}

async function assertHttpUrlAllowed(urlText: string, settings: AiToolingSettings['http']): Promise<void> {
  for (const prefix of settings.denyUrlPrefixes || []) {
    const value = String(prefix || '').trim()
    if (value && urlText.startsWith(value)) {
      throw new Error(`URL denied by prefix policy: ${value}`)
    }
  }

  const url = new URL(urlText)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP/HTTPS protocols are allowed')
  }

  if (isHostDenied(url.hostname, settings.denyHosts || [])) {
    throw new Error(`URL host is denied: ${url.hostname}`)
  }

  const blockList = buildBlockList(settings.denyCidrs || [])
  const ips = await collectResolvedIps(url.hostname)
  for (const ip of ips) {
    const type = isIP(ip) === 6 ? 'ipv6' : 'ipv4'
    if (blockList.check(ip, type)) {
      throw new Error(`URL resolved to denied IP range: ${ip}`)
    }
  }
}

async function performHttpRequest(input: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
  maxBytes: number
  deny: AiToolingSettings['http']
  redirectCount: number
}): Promise<{
  finalUrl: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  truncated: boolean
}> {
  await assertHttpUrlAllowed(input.url, input.deny)
  const url = new URL(input.url)
  const requester = url.protocol === 'https:' ? https : http

  const payload = input.body != null ? Buffer.from(input.body, 'utf8') : undefined

  return await new Promise((resolve, reject) => {
    const req = requester.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: input.headers
      },
      async (res) => {
        const status = Number(res.statusCode || 0)
        const location = res.headers.location

        if (status >= 300 && status < 400 && location && input.redirectCount < 3) {
          const redirectUrl = new URL(location, url).toString()
          try {
            const redirected = await performHttpRequest({
              ...input,
              url: redirectUrl,
              redirectCount: input.redirectCount + 1,
              method: status === 303 ? 'GET' : input.method,
              body: status === 303 ? undefined : input.body
            })
            resolve(redirected)
            return
          } catch (error) {
            reject(error)
            return
          }
        }

        const chunks: Buffer[] = []
        let bytes = 0
        let truncated = false

        res.on('data', (chunk: Buffer) => {
          const data = Buffer.from(chunk)
          if (bytes >= input.maxBytes) {
            truncated = true
            return
          }
          const remaining = input.maxBytes - bytes
          if (data.length <= remaining) {
            chunks.push(data)
            bytes += data.length
            return
          }
          chunks.push(data.subarray(0, remaining))
          bytes = input.maxBytes
          truncated = true
        })

        res.on('end', () => {
          resolve({
            finalUrl: url.toString(),
            status,
            statusText: String(res.statusMessage || ''),
            headers: toHeaderObject(res.headers),
            body: Buffer.concat(chunks).toString('utf8'),
            truncated
          })
        })

        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('HTTP request timeout'))
    })

    req.on('error', (error) => reject(error))

    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

function normalizeToolError(error: unknown): { success: false; error: string } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    success: false,
    error: message
  }
}

export class AiInternalToolRuntime {
  /** Per-request skill activation deduplication. Key = requestId */
  private readonly activationScopes = new Map<string, Set<string>>()

  constructor(private readonly deps: InternalToolRuntimeDeps) {}

  /** Create an activation scope for a specific request. */
  createActivationScope(requestId: string): void {
    this.activationScopes.set(requestId, new Set())
  }

  /** Clean up the activation scope when a request finishes. */
  cleanupActivationScope(requestId: string): void {
    this.activationScopes.delete(requestId)
  }

  private getActivatedSkillIds(requestId?: string): Set<string> {
    if (!requestId) return new Set() // no scope → no dedup (safe fallback)
    let scope = this.activationScopes.get(requestId)
    if (!scope) {
      scope = new Set()
      this.activationScopes.set(requestId, scope)
    }
    return scope
  }

  private async runManagedCommand(input: RunCommandInput, context?: AiToolContext): Promise<RunCommandResult> {
    return await this.deps.runCommand(
      {
        ...input,
        shell: false
      },
      this.deps.resolveRunCommandContext(context)
    )
  }

  async execute(input: { name: AiInternalToolName; args: unknown; context?: AiToolContext }): Promise<unknown> {
    try {
      switch (input.name) {
        case AI_READ_FILE_TOOL_NAME:
          return await this.readFileTool(input.args)
        case AI_LIST_DIR_TOOL_NAME:
          return await this.listDirTool(input.args)
        case AI_SEARCH_TEXT_TOOL_NAME:
          return await this.searchTextTool(input.args)
        case AI_APPLY_PATCH_TOOL_NAME:
          return await this.applyPatchTool(input.args, input.context)
        case AI_HTTP_FETCH_TOOL_NAME:
          return await this.httpFetchTool(input.args)
        case AI_RUN_SCRIPT_TOOL_NAME:
          return await this.runScriptTool(input.args, input.context)
        case AI_GIT_STATUS_TOOL_NAME:
          return await this.gitStatusTool(input.args, input.context)
        case AI_GIT_DIFF_TOOL_NAME:
          return await this.gitDiffTool(input.args, input.context)
        case AI_ACTIVATE_SKILL_TOOL_NAME:
          return await this.activateSkillTool(input.args, input.context)
        case AI_WEB_SEARCH_TOOL_NAME:
          return await this.webSearchTool(input.args)
        case AI_WEB_FETCH_TOOL_NAME:
          return await this.webFetchTool(input.args)
        default:
          return normalizeToolError(`Unsupported internal tool: ${input.name}`)
      }
    } catch (error) {
      return normalizeToolError(error)
    }
  }

  private async readFileTool(args: unknown): Promise<unknown> {
    const policy = this.deps.getToolingSettings().filesystem
    const input = parseObject(args)
    const filePath = String(input.path || '').trim()
    if (!filePath) throw new Error('path is required')
    const encoding = String(input.encoding || 'utf-8').trim() === 'base64' ? 'base64' : 'utf-8'
    const maxBytes = clamp(
      Number(parseOptionalNumber(input.maxBytes) || policy.maxReadBytes),
      1024,
      policy.maxReadBytes
    )
    const resolved = ensurePathAllowed(filePath, policy.allowedRoots, 'filesystem.read_file')
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) throw new Error('target path is not a file')

    const file = await fs.open(resolved, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await file.read(buffer, 0, maxBytes + 1, 0)
      const truncated = bytesRead > maxBytes || stat.size > maxBytes
      const data = buffer.subarray(0, Math.min(bytesRead, maxBytes))
      return {
        success: true,
        path: resolved,
        size: stat.size,
        encoding,
        truncated,
        content: encoding === 'base64' ? data.toString('base64') : data.toString('utf8')
      }
    } finally {
      await file.close()
    }
  }

  private async listDirTool(args: unknown): Promise<unknown> {
    const policy = this.deps.getToolingSettings().filesystem
    const input = parseObject(args)
    const targetPath = String(input.path || '').trim()
    if (!targetPath) throw new Error('path is required')
    const recursive = input.recursive === true
    const includeStat = input.includeStat === true
    const maxEntries = clamp(
      Number(parseOptionalNumber(input.maxEntries) || policy.maxEntries),
      1,
      policy.maxEntries
    )

    const root = ensurePathAllowed(targetPath, policy.allowedRoots, 'filesystem.list_dir')
    const queue: string[] = [root]
    const entries: Array<Record<string, unknown>> = []
    let truncated = false

    while (queue.length > 0) {
      const current = queue.shift() as string
      const children = await fs.readdir(current, { withFileTypes: true })
      for (const child of children) {
        const childPath = path.join(current, child.name)
        const relativePath = path.relative(root, childPath) || child.name
        const row: Record<string, unknown> = {
          name: child.name,
          path: childPath,
          relativePath,
          isFile: child.isFile(),
          isDirectory: child.isDirectory(),
          isSymbolicLink: child.isSymbolicLink()
        }
        if (includeStat) {
          try {
            const stat = await fs.stat(childPath)
            row.size = stat.size
            row.modifiedAt = stat.mtimeMs
            row.createdAt = stat.birthtimeMs
          } catch {
            // ignore stat error per entry
          }
        }
        entries.push(row)
        if (entries.length >= maxEntries) {
          truncated = true
          break
        }
        if (recursive && child.isDirectory() && !child.isSymbolicLink()) {
          queue.push(childPath)
        }
      }
      if (truncated) break
    }

    return {
      success: true,
      path: root,
      recursive,
      truncated,
      entries
    }
  }

  private async searchTextTool(args: unknown): Promise<unknown> {
    const policy = this.deps.getToolingSettings().filesystem
    const input = parseObject(args)
    const rootPath = String(input.rootPath || '').trim()
    const query = String(input.query || '')
    if (!rootPath) throw new Error('rootPath is required')
    if (!query) throw new Error('query is required')

    const caseSensitive = input.caseSensitive === true
    const maxResults = clamp(
      Number(parseOptionalNumber(input.maxResults) || policy.maxSearchHits),
      1,
      policy.maxSearchHits
    )
    const globText = String(input.glob || '').trim()
    const globRegex = globText ? wildcardToRegExp(globText) : null

    const root = ensurePathAllowed(rootPath, policy.allowedRoots, 'filesystem.search_text')
    const matches: Array<{ file: string; line: number; column: number; preview: string }> = []
    const queue: string[] = [root]
    const searchNeedle = caseSensitive ? query : query.toLowerCase()
    let truncated = false

    while (queue.length > 0) {
      const current = queue.shift() as string
      const children = await fs.readdir(current, { withFileTypes: true })
      for (const child of children) {
        const childPath = path.join(current, child.name)
        if (child.isDirectory() && !child.isSymbolicLink()) {
          queue.push(childPath)
          continue
        }
        if (!child.isFile()) continue

        const relativePath = path.relative(root, childPath)
        if (globRegex && !globRegex.test(relativePath.replace(/\\/g, '/'))) {
          continue
        }

        const stat = await fs.stat(childPath)
        if (stat.size > policy.maxSearchFileBytes) {
          continue
        }

        let text: string
        try {
          text = await fs.readFile(childPath, 'utf8')
        } catch {
          continue
        }

        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i += 1) {
          const lineText = lines[i]
          const haystack = caseSensitive ? lineText : lineText.toLowerCase()
          const column = haystack.indexOf(searchNeedle)
          if (column < 0) continue
          matches.push({
            file: childPath,
            line: i + 1,
            column: column + 1,
            preview: lineText.slice(0, 400)
          })
          if (matches.length >= maxResults) {
            truncated = true
            break
          }
        }
        if (truncated) break
      }
      if (truncated) break
    }

    return {
      success: true,
      rootPath: root,
      query,
      caseSensitive,
      truncated,
      matches
    }
  }

  private async applyPatchTool(args: unknown, context?: AiToolContext): Promise<unknown> {
    const policy = this.deps.getToolingSettings().patch
    const input = parseObject(args)
    const patchText = String(input.patch || '')
    if (!patchText.trim()) throw new Error('patch is required')
    if (Buffer.byteLength(patchText, 'utf8') > policy.maxPatchBytes) {
      throw new Error('patch exceeds maxPatchBytes policy')
    }

    const mode = String(input.mode || 'dry-run').trim() === 'apply' ? 'apply' : 'dry-run'
    const baseDirRaw = String(input.baseDir || process.cwd()).trim() || process.cwd()
    const baseDir = ensurePathAllowed(baseDirRaw, policy.allowedRoots, 'patch')
    const patchHash = sha256(patchText)
    const now = Date.now()
    prunePatchDryRunCache(now)

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mulby-patch-'))
    const patchPath = path.join(tempDir, 'change.patch')
    await fs.writeFile(patchPath, patchText, 'utf8')

    try {
      const changedFiles = summarizePatchFiles(patchText)
      const checkRepo = await this.runManagedCommand({
        command: 'git',
        args: ['-C', baseDir, 'rev-parse', '--is-inside-work-tree'],
        cwd: baseDir,
        timeoutMs: 10_000
      }, context)
      if (!checkRepo.success) {
        return {
          success: false,
          mode,
          baseDir,
          changedFiles,
          stderr: checkRepo.stderr || 'Not a git repository',
          exitCode: checkRepo.exitCode,
          timedOut: checkRepo.timedOut,
          truncated: checkRepo.truncated
        }
      }

      if (mode === 'dry-run') {
        const result = await this.runManagedCommand({
          command: 'git',
          args: ['-C', baseDir, 'apply', '--check', patchPath],
          cwd: baseDir,
          timeoutMs: 20_000
        }, context)
        const dryRunToken = result.success
          ? (() => {
              const token = randomUUID()
              patchDryRunCache.set(token, {
                hash: patchHash,
                baseDir,
                expiresAt: now + PATCH_DRY_RUN_TTL_MS
              })
              return token
            })()
          : undefined

        return {
          success: result.success,
          mode,
          baseDir,
          changedFiles,
          dryRunToken,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          truncated: result.truncated
        }
      }

      if (policy.requireDryRunFirst) {
        const token = String(input.dryRunToken || '').trim()
        if (!token) {
          throw new Error('dryRunToken is required before apply')
        }
        const record = patchDryRunCache.get(token)
        if (!record || record.expiresAt <= now) {
          throw new Error('dryRunToken is missing or expired')
        }
        if (record.hash !== patchHash || record.baseDir !== baseDir) {
          throw new Error('dryRunToken does not match patch/baseDir')
        }
      }

      const result = await this.runManagedCommand({
        command: 'git',
        args: ['-C', baseDir, 'apply', patchPath],
        cwd: baseDir,
        timeoutMs: 30_000
      }, context)

      if (policy.requireDryRunFirst) {
        const token = String(input.dryRunToken || '').trim()
        if (token) patchDryRunCache.delete(token)
      }

      return {
        success: result.success,
        mode,
        baseDir,
        changedFiles,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private async httpFetchTool(args: unknown): Promise<unknown> {
    const policy = this.deps.getToolingSettings().http
    const input = parseObject(args)
    const url = String(input.url || '').trim()
    if (!url) throw new Error('url is required')

    const method = String(input.method || 'GET').trim().toUpperCase()
    const headersObj = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)
      ? Object.fromEntries(
          Object.entries(input.headers as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])
        )
      : {}
    const body = input.body == null ? undefined : String(input.body)
    const timeoutMs = clamp(
      Number(parseOptionalNumber(input.timeoutMs) || policy.timeoutMs),
      1000,
      policy.timeoutMs
    )
    const maxBytes = clamp(
      Number(parseOptionalNumber(input.maxBytes) || policy.maxResponseBytes),
      1024,
      policy.maxResponseBytes
    )

    const result = await performHttpRequest({
      url,
      method,
      headers: headersObj,
      body,
      timeoutMs,
      maxBytes,
      deny: policy,
      redirectCount: 0
    })

    return {
      success: true,
      url,
      finalUrl: result.finalUrl,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      truncated: result.truncated
    }
  }

  private async runScriptTool(args: unknown, context?: AiToolContext): Promise<unknown> {
    const policy = this.deps.getToolingSettings().runScript
    const input = parseObject(args)
    const scriptId = String(input.scriptId || '').trim()
    if (!scriptId) throw new Error('scriptId is required')

    const entry = (policy.entries || []).find((item) => item.id === scriptId)
    if (!entry) {
      throw new Error(`scriptId not found: ${scriptId}`)
    }

    const runArgs = normalizeStringArray(input.args, 300)
    const env =
      input.env && typeof input.env === 'object' && !Array.isArray(input.env)
        ? Object.fromEntries(
            Object.entries(input.env as Record<string, unknown>).map(([key, value]) => [String(key), String(value ?? '')])
          )
        : undefined

    const allowedEnv = new Set((entry.allowEnvKeys || []).map((key) => String(key).trim().toUpperCase()))
    if (env && allowedEnv.size > 0) {
      const disallowed = Object.keys(env)
        .map((key) => key.trim().toUpperCase())
        .filter((key) => !allowedEnv.has(key))
      if (disallowed.length > 0) {
        throw new Error(`env keys are not allowed for script ${scriptId}: ${disallowed.join(', ')}`)
      }
    }

    const timeoutMs = clamp(
      Number(parseOptionalNumber(input.timeoutMs) || entry.timeoutMs || policy.defaultTimeoutMs),
      1000,
      policy.maxTimeoutMs
    )

    const commandInput: RunCommandInput = {
      command: entry.command,
      args: [...(entry.args || []), ...runArgs],
      cwd: entry.cwd,
      env,
      timeoutMs,
      shell: false
    }

    const runContext = this.deps.resolveRunCommandContext(context)
    try {
      const result = await this.deps.runCommand(commandInput, runContext)
      return {
        ...result,
        scriptId
      }
    } catch (error) {
      return {
        ...normalizeFailedRunCommandResult({
          error,
          command: commandInput.command,
          args: commandInput.args,
          cwd: commandInput.cwd,
          shell: false
        }),
        scriptId
      }
    }
  }

  private async gitStatusTool(args: unknown, context?: AiToolContext): Promise<unknown> {
    const policy = this.deps.getToolingSettings().git
    const input = parseObject(args)
    const repoPathRaw = String(input.repoPath || '').trim()
    if (!repoPathRaw) throw new Error('repoPath is required')
    const short = input.short !== false
    const repoPath = ensurePathAllowed(repoPathRaw, policy.allowedRepoRoots, 'git')

    const check = await this.runManagedCommand({
      command: 'git',
      args: ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
      cwd: repoPath,
      timeoutMs: 10_000
    }, context)
    if (!check.success) {
      return {
        success: false,
        repoPath,
        stdout: check.stdout,
        stderr: check.stderr || 'Not a git repository',
        exitCode: check.exitCode,
        timedOut: check.timedOut,
        truncated: check.truncated
      }
    }

    const statusResult = await this.runManagedCommand({
      command: 'git',
      args: short
        ? ['-C', repoPath, 'status', '--short', '--branch']
        : ['-C', repoPath, 'status', '--porcelain=v1', '--branch'],
      cwd: repoPath,
      timeoutMs: 20_000
    }, context)

    return {
      success: statusResult.success,
      repoPath,
      short,
      stdout: statusResult.stdout,
      stderr: statusResult.stderr,
      exitCode: statusResult.exitCode,
      timedOut: statusResult.timedOut,
      truncated: statusResult.truncated
    }
  }

  private async gitDiffTool(args: unknown, context?: AiToolContext): Promise<unknown> {
    const policy = this.deps.getToolingSettings().git
    const input = parseObject(args)
    const repoPathRaw = String(input.repoPath || '').trim()
    if (!repoPathRaw) throw new Error('repoPath is required')
    const repoPath = ensurePathAllowed(repoPathRaw, policy.allowedRepoRoots, 'git')
    const targetRaw = String(input.target || 'working').trim().toLowerCase()
    const target = targetRaw === 'staged' || targetRaw === 'commit' ? targetRaw : 'working'
    const ref = String(input.ref || 'HEAD').trim() || 'HEAD'
    const maxBytes = clamp(
      Number(parseOptionalNumber(input.maxBytes) || policy.maxDiffBytes),
      8 * 1024,
      policy.maxDiffBytes
    )

    const check = await this.runManagedCommand({
      command: 'git',
      args: ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
      cwd: repoPath,
      timeoutMs: 10_000
    }, context)
    if (!check.success) {
      return {
        success: false,
        repoPath,
        target,
        stdout: check.stdout,
        stderr: check.stderr || 'Not a git repository',
        exitCode: check.exitCode,
        timedOut: check.timedOut,
        truncated: check.truncated
      }
    }

    const argsList = target === 'staged'
      ? ['-C', repoPath, 'diff', '--staged']
      : target === 'commit'
        ? ['-C', repoPath, 'show', '--format=', '--no-color', ref]
        : ['-C', repoPath, 'diff']

    const result = await this.runManagedCommand({
      command: 'git',
      args: argsList,
      cwd: repoPath,
      timeoutMs: 30_000
    }, context)

    return {
      success: result.success,
      repoPath,
      target,
      ref: target === 'commit' ? ref : undefined,
      stdout: result.stdout.length > maxBytes ? result.stdout.slice(0, maxBytes) : result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      truncated: result.truncated || result.stdout.length > maxBytes
    }
  }

  private async activateSkillTool(args: unknown, context?: AiToolContext): Promise<unknown> {
    const input = parseObject(args)
    const skillName = String(input.name || '').trim()
    if (!skillName) throw new Error('name is required')

    const { aiSkillService } = await import('../skills')
    const enabledSkills = aiSkillService.listEnabled()
    const record = enabledSkills.find(
      (r) => r.descriptor.name === skillName || r.id === skillName
    )
    if (!record) {
      return {
        success: false,
        error: `Skill not found or not enabled: ${skillName}`
      }
    }

    const activatedSkillIds = this.getActivatedSkillIds(context?.requestId)
    if (activatedSkillIds.has(record.id)) {
      return {
        success: true,
        skillId: record.id,
        skillName: record.descriptor.name,
        alreadyActivated: true,
        content: `Skill "${record.descriptor.name}" is already active in this conversation.`
      }
    }
    activatedSkillIds.add(record.id)

    // Load SKILL.md body (Tier 2)
    let promptTemplate: string | undefined
    const existing = String(record.descriptor.promptTemplate || '').trim()
    if (existing) {
      promptTemplate = existing
    } else if (record.skillMdPath) {
      try {
        const content = await fs.readFile(record.skillMdPath, 'utf8')
        const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/)
        const body = String(match?.[1] || '').trim()
        promptTemplate = body || undefined
      } catch {
        // file read error; template stays undefined
      }
    }

    // List bundled resources (Tier 3 references)
    const resources: string[] = []
    if (record.installPath) {
      const resourceDirs = ['scripts', 'references', 'assets']
      for (const dir of resourceDirs) {
        const dirPath = path.join(record.installPath, dir)
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isFile()) {
              resources.push(`${dir}/${entry.name}`)
            }
          }
        } catch {
          // directory doesn't exist
        }
      }
    }

    // Build runtime hint
    const installPath = String(record.installPath || '').trim()
    const runtimeHintLines: string[] = []
    if (installPath) {
      runtimeHintLines.push(`Skill directory: ${installPath}`)
      runtimeHintLines.push('Relative paths in this skill are relative to the skill directory.')
      runtimeHintLines.push('Reuse existing scripts from this skill before writing ad-hoc inline scripts.')
    }

    // Build structured wrapping per Agent Skills spec
    const lines: string[] = []
    lines.push(`<skill_content name="${record.descriptor.name}">`)
    if (promptTemplate) lines.push(promptTemplate)
    if (runtimeHintLines.length > 0) {
      lines.push('')
      lines.push(runtimeHintLines.join('\n'))
    }
    if (resources.length > 0) {
      lines.push('')
      lines.push('<skill_resources>')
      for (const file of resources) {
        lines.push(`  <file>${file}</file>`)
      }
      lines.push('</skill_resources>')
    }
    lines.push('</skill_content>')

    return {
      success: true,
      skillId: record.id,
      skillName: record.descriptor.name,
      content: lines.join('\n'),
      // Expose the skill's declared grants for informational purposes.
      //
      // KNOWN LIMITATION: These grants are returned but NOT dynamically applied
      // to the current request's tool set. The tool set is resolved once at
      // request start (in prepareChatRequest → resolveAiCapabilityPolicy →
      // buildTools), before any tool calls execute. There is no mid-request
      // tool injection mechanism yet.
      //
      // For skills that need additional MCP servers or non-default internal
      // tools, use manual mode (explicit skillIds) so their grants are
      // pre-resolved in the initial tool set.
      //
      // TODO: Implement dynamic tool injection in the tool loop to fully
      // support progressive disclosure for skills with custom grants.
      grants: {
        capabilities: record.descriptor.mulbyExtensions?.capabilities || record.descriptor.capabilities || [],
        internalTools: record.descriptor.mulbyExtensions?.internalTools || record.descriptor.internalTools || [],
        mcpPolicy: record.descriptor.mulbyExtensions?.mcpPolicy || record.descriptor.mcpPolicy || undefined
      }
    }
  }

  // ==================== web_search / web_fetch ====================

  private async webSearchTool(args: unknown): Promise<unknown> {
    const params = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const query = String(params.query || '').trim()
    if (!query) {
      return normalizeToolError('query is required')
    }

    const webSearchSettings = this.deps.getToolingSettings().webSearch
    const service = new WebSearchService(webSearchSettings)

    try {
      const response = await service.search({
        query,
        maxResults: Number(params.maxResults) || undefined,
        language: String(params.language || '').trim() || undefined
      })

      // 格式化为 AI 友好的输出
      const formatted = response.results.map((r, i) => {
        const parts = [`### ${i + 1}. ${r.title}`, `URL: ${r.url}`]
        if (r.snippet) parts.push(`> ${r.snippet}`)
        if (r.content) parts.push(r.content.slice(0, 500))
        return parts.join('\n')
      })

      return {
        success: true,
        query: response.query,
        resultCount: response.results.length,
        content: formatted.join('\n\n---\n\n') || 'No results found'
      }
    } catch (error) {
      return normalizeToolError(error)
    }
  }

  private async webFetchTool(args: unknown): Promise<unknown> {
    const params = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const url = String(params.url || '').trim()
    if (!url) {
      return normalizeToolError('url is required')
    }

    // 验证 URL 协议
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return normalizeToolError('Only http and https URLs are supported')
      }
    } catch {
      return normalizeToolError(`Invalid URL: ${url}`)
    }

    // 复用完整 HTTP deny 策略（denyHosts + denyCidrs + denyUrlPrefixes）
    const httpSettings = this.deps.getToolingSettings().http
    try {
      await assertHttpUrlAllowed(url, httpSettings)
    } catch (error) {
      return normalizeToolError(error)
    }

    const webSearchSettings = this.deps.getToolingSettings().webSearch
    const service = new WebSearchService(webSearchSettings)

    try {
      const response = await service.fetch({
        url,
        maxLength: Number(params.maxLength) || undefined
      })

      return {
        success: true,
        url: response.url,
        title: response.title,
        format: response.format,
        truncated: response.truncated,
        content: response.content
      }
    } catch (error) {
      return normalizeToolError(error)
    }
  }
}

export function createAiInternalToolRuntime(deps: InternalToolRuntimeDeps): AiInternalToolRuntime {
  return new AiInternalToolRuntime(deps)
}
