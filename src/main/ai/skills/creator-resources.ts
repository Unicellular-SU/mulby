import fs from 'node:fs/promises'
import path from 'node:path'

export const AI_SKILL_CREATOR_TOOL_NAME = 'mulby_skill_creator_run_command'
export const AI_SKILL_CREATOR_INTERNAL_TAG = 'mulby-skill-creator'

export interface SkillCreatorResourcePack {
  rootPath: string
  skillMdPath: string
  skillMdContent: string
  referenceFiles: Array<{
    filename: string
    content: string
  }>
  scriptFiles: string[]
}

let cachedPack: SkillCreatorResourcePack | null | undefined

function getSkillCreatorRootCandidates(): string[] {
  const candidates = [
    path.resolve(process.cwd(), 'resources/skills/skill-creator'),
    path.resolve(__dirname, '../../../../resources/skills/skill-creator'),
    path.resolve(process.resourcesPath || '', 'resources/skills/skill-creator'),
    path.resolve(process.resourcesPath || '', 'skills/skill-creator')
  ]
  const seen = new Set<string>()
  return candidates.filter((item) => {
    if (!item) return false
    if (seen.has(item)) return false
    seen.add(item)
    return true
  })
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

export async function resolveSkillCreatorRootPath(): Promise<string | null> {
  for (const rootPath of getSkillCreatorRootCandidates()) {
    const skillMdPath = path.join(rootPath, 'SKILL.md')
    if (await fileExists(skillMdPath)) {
      return rootPath
    }
  }
  return null
}

async function readReferenceFiles(rootPath: string): Promise<SkillCreatorResourcePack['referenceFiles']> {
  const referenceDir = path.join(rootPath, 'references')
  const fileNames = ['workflows.md', 'output-patterns.md']
  const out: SkillCreatorResourcePack['referenceFiles'] = []
  for (const filename of fileNames) {
    const fullPath = path.join(referenceDir, filename)
    try {
      const content = await fs.readFile(fullPath, 'utf8')
      if (content.trim()) {
        out.push({ filename, content })
      }
    } catch {
      // ignore missing optional references
    }
  }
  return out
}

async function readScriptFiles(rootPath: string): Promise<string[]> {
  const scriptsDir = path.join(rootPath, 'scripts')
  try {
    const entries = await fs.readdir(scriptsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

export async function loadSkillCreatorResourcePack(): Promise<SkillCreatorResourcePack | null> {
  if (cachedPack !== undefined) {
    return cachedPack
  }
  const rootPath = await resolveSkillCreatorRootPath()
  if (!rootPath) {
    cachedPack = null
    return null
  }

  const skillMdPath = path.join(rootPath, 'SKILL.md')
  try {
    const skillMdContent = await fs.readFile(skillMdPath, 'utf8')
    cachedPack = {
      rootPath,
      skillMdPath,
      skillMdContent,
      referenceFiles: await readReferenceFiles(rootPath),
      scriptFiles: await readScriptFiles(rootPath)
    }
    return cachedPack
  } catch {
    cachedPack = null
    return null
  }
}
