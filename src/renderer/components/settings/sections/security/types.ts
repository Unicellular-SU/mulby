export type RuleDraft = {
  mode: 'exact' | 'prefix'
  value: string
}

export type GrantDraft = {
  capability: string
  decision: 'allow' | 'deny'
  expiresAt: string
}

export type RunScriptDraft = {
  id: string
  command: string
  args: string
  cwd: string
  timeoutMs: string
  allowEnvKeys: string
}
