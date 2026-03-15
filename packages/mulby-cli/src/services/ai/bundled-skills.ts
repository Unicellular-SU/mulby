import * as fs from 'fs';
import * as path from 'path';

export type BundledSkillId = 'develop-mulby-plugin' | 'generate-electron-icons';

interface BundledSkillSourceDefinition {
  id: BundledSkillId;
  defaultActive: boolean;
  descriptionFallback: string;
  sourceCandidates: string[];
}

export interface BundledSkillRecord {
  id: BundledSkillId;
  name: string;
  description: string;
  rootPath: string;
  skillMdPath: string;
  defaultActive: boolean;
  referencesRootPath?: string;
  scriptsRootPath?: string;
  skillBody: string;
}

const BUNDLED_SKILL_DEFINITIONS: BundledSkillSourceDefinition[] = [
  {
    id: 'develop-mulby-plugin',
    defaultActive: true,
    descriptionFallback: 'Create, modify, validate, and package Mulby plugins with bundled Mulby references.',
    sourceCandidates: [
      path.join(__dirname, 'bundled-skills', 'develop-mulby-plugin'),
      path.resolve(__dirname, '../../../../../skills/develop-mulby-plugin')
    ]
  },
  {
    id: 'generate-electron-icons',
    defaultActive: false,
    descriptionFallback: 'Generate Electron app and tray icons from SVG sources.',
    sourceCandidates: [
      path.join(__dirname, 'bundled-skills', 'generate-electron-icons'),
      path.resolve(__dirname, '../../../../../skills/generate-electron-icons')
    ]
  }
];

interface SplitMarkdownResult {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(markdown: string): SplitMarkdownResult {
  const normalized = String(markdown || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: '',
      body: normalized.trim()
    };
  }
  return {
    frontmatter: match[1].trim(),
    body: match[2].trim()
  };
}

function stripQuotes(value: string): string {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseMetadata(frontmatter: string): { name?: string; description?: string } {
  const out: { name?: string; description?: string } = {};
  for (const rawLine of String(frontmatter || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1));
    if (key === 'name' || key === 'description') {
      out[key] = value;
    }
  }
  return out;
}

function pathInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function findExistingDirectory(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function normalizeAliasPath(input: string): string {
  return String(input || '').trim().replace(/\\/g, '/');
}

function isBundledSkillId(value: string): value is BundledSkillId {
  return value === 'develop-mulby-plugin' || value === 'generate-electron-icons';
}

function loadBundledSkill(definition: BundledSkillSourceDefinition): BundledSkillRecord | null {
  const rootPath = findExistingDirectory(definition.sourceCandidates);
  if (!rootPath) return null;

  const skillMdPath = path.join(rootPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;

  const markdown = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter, body } = splitFrontmatter(markdown);
  const metadata = parseMetadata(frontmatter);
  const referencesRootPath = path.join(rootPath, 'references');
  const scriptsRootPath = path.join(rootPath, 'scripts');

  return {
    id: definition.id,
    name: metadata.name || definition.id,
    description: metadata.description || definition.descriptionFallback,
    rootPath,
    skillMdPath,
    defaultActive: definition.defaultActive,
    referencesRootPath: fs.existsSync(referencesRootPath) ? referencesRootPath : undefined,
    scriptsRootPath: fs.existsSync(scriptsRootPath) ? scriptsRootPath : undefined,
    skillBody: body
  };
}

export function listBundledSkills(): BundledSkillRecord[] {
  return BUNDLED_SKILL_DEFINITIONS
    .map((definition) => loadBundledSkill(definition))
    .filter((record): record is BundledSkillRecord => !!record);
}

export function getBundledSkill(skillId: BundledSkillId): BundledSkillRecord | null {
  return listBundledSkills().find((record) => record.id === skillId) || null;
}

export function resolveBundledSkillFile(inputPath: string): {
  skill: BundledSkillRecord;
  fullPath: string;
  relativePath: string;
  aliasPath: string;
} | null {
  const normalized = normalizeAliasPath(inputPath);
  const prefix = '@skills/';
  if (!normalized.startsWith(prefix)) return null;

  const rest = normalized.slice(prefix.length).replace(/^\/+/, '');
  const parts = rest.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const skillId = parts.shift() || '';
  if (!isBundledSkillId(skillId)) return null;

  const skill = getBundledSkill(skillId);
  if (!skill) return null;

  const relativePath = parts.join('/');
  if (relativePath.includes('..') || path.isAbsolute(relativePath)) return null;

  const fullPath = relativePath ? path.resolve(skill.rootPath, relativePath) : skill.rootPath;
  if (!pathInside(skill.rootPath, fullPath)) return null;

  return {
    skill,
    fullPath,
    relativePath,
    aliasPath: relativePath ? `@skills/${skillId}/${relativePath}` : `@skills/${skillId}`
  };
}

function buildSkillCatalogLines(record: BundledSkillRecord): string[] {
  const lines: string[] = [
    `- ${record.id}: ${record.description}`,
    `  - Read first: @skills/${record.id}/SKILL.md`
  ];

  if (record.id === 'develop-mulby-plugin') {
    lines.push('  - Common refs: @skills/develop-mulby-plugin/references/plugin-development-guide.md');
    lines.push('  - API navigator: @skills/develop-mulby-plugin/references/api-map.md');
    lines.push('  - Full API docs: @skills/develop-mulby-plugin/references/apis/README.md');
  }

  if (record.id === 'generate-electron-icons' && record.scriptsRootPath) {
    const generatorScript = path.join(record.scriptsRootPath, 'generate_electron_icons.py');
    lines.push(`  - Reuse existing script via run_command: ${JSON.stringify(generatorScript)}`);
  }

  return lines;
}

export function buildBundledSkillBootstrapPrompt(): string {
  const records = listBundledSkills();
  if (records.length === 0) {
    return 'Bundled skills are unavailable. Fall back to project inspection and current runtime types.';
  }

  const lines: string[] = [
    '## Bundled Skills',
    'Mulby CLI ships with bundled local skills for plugin development. Use them instead of legacy copied prompt files.',
    'Bundled skill files are read-only references. Use read_file, list_dir, search_files, and read_file_outline with paths under `@skills/<skill-id>/...`.',
    'Never write, delete, or move files under `@skills/`; edit only the plugin project files in the working directory.',
    '',
    '### Active Skill Policy',
    '- Always start by reading `@skills/develop-mulby-plugin/SKILL.md` before making major Mulby architecture decisions.',
    '- When icon generation, icon replacement, or branded asset finalization is in scope, also read `@skills/generate-electron-icons/SKILL.md`.',
    '- Follow the skill workflow and only open the specific reference files that the skill tells you to use.',
    '',
    '### Bundled Skill Catalog'
  ];

  for (const record of records) {
    lines.push(...buildSkillCatalogLines(record));
  }

  const activeSkill = records.find((record) => record.id === 'develop-mulby-plugin');
  if (activeSkill?.skillBody) {
    lines.push('', '### Active Skill Body: develop-mulby-plugin', activeSkill.skillBody);
  }

  const iconSkill = records.find((record) => record.id === 'generate-electron-icons');
  if (iconSkill?.skillBody) {
    lines.push('', '### Auxiliary Skill Body: generate-electron-icons', iconSkill.skillBody);
  }

  return lines.join('\n');
}

export function isPathInside(root: string, target: string): boolean {
  return pathInside(root, target);
}
