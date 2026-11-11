// What a "sync my setup" pass should change, decided without touching disk or the
// network: which local skills fit in the personal store's runtime budget, which
// files to upload or delete, and how CLAUDE.md splits into personal Instructions.
// local-setup-sync.ts does the I/O around it.

/** The runtime refuses the whole personal bundle past 2,000 files or 32 MB, so stay under it. */
export const RUNTIME_FILE_BUDGET = 1_800
export const RUNTIME_BYTE_BUDGET = 28 * 1024 * 1024
/** A skill this large would crowd out dozens of others; leave it on this computer. */
export const MAX_SYNCED_SKILL_BYTES = 4 * 1024 * 1024
/** localSkillEntries stops walking at 200 files, so a skill that reaches it is incomplete. */
export const MAX_SYNCED_SKILL_FILES = 200
/** A store object larger than this is rejected, so it is never uploaded. */
export const MAX_SYNCED_FILE_BYTES = 10_000_000

export type LocalSkillFile = { relPath: string; size: number; sha256: string }
export type LocalSkillSnapshot = { name: string; files: LocalSkillFile[] }
export type RemoteObject = { key: string; size: number }

export type SkippedSkill = {
  name: string
  reason: 'too_large' | 'too_many_files' | 'name_taken' | 'over_budget' | 'unreadable'
}

export type SkillSyncPlan = {
  /** Skills that will be in the personal store after this pass, managed by this computer. */
  synced: string[]
  uploads: { name: string; file: LocalSkillFile; key: string }[]
  /** Stale files inside skills that stay synced. */
  deleteKeys: string[]
  /** Previously synced skills that are gone locally or no longer fit. */
  deleteSkills: string[]
  skipped: SkippedSkill[]
}

export function skillKey(name: string, relPath: string): string {
  return `skills/${name}/${relPath}`
}

function skillOfKey(key: string): string | null {
  const match = /^skills\/([^/]+)\//u.exec(key)

  return match?.[1] ?? null
}

/**
 * Plan one pass. `managed` holds, per skill this computer synced before, the
 * sha256 of each file as last uploaded; anything in the store this computer
 * did not put there is left alone and counts against the budget.
 */
export function planSkillSync(
  local: readonly LocalSkillSnapshot[],
  managed: Readonly<Record<string, Readonly<Record<string, string>>>>,
  remote: readonly RemoteObject[],
): SkillSyncPlan {
  const remoteKeys = new Set(remote.map((object) => object.key))
  const foreign = remote.filter((object) => {
    const name = skillOfKey(object.key)

    return name === null || !(name in managed)
  })
  const foreignNames = new Set(foreign.map((object) => skillOfKey(object.key)))
  let files = foreign.length
  let bytes = foreign.reduce((sum, object) => sum + object.size, 0)
  const skipped: SkippedSkill[] = []
  const candidates: { name: string; files: LocalSkillFile[]; bytes: number }[] = []

  for (const skill of local) {
    const kept = skill.files.filter((file) => file.size <= MAX_SYNCED_FILE_BYTES)
    const size = kept.reduce((sum, file) => sum + file.size, 0)

    // The walk stops at 200 files, possibly before reaching SKILL.md, so that comes first.
    if (skill.files.length >= MAX_SYNCED_SKILL_FILES)
      skipped.push({ name: skill.name, reason: 'too_many_files' })
    // Its SKILL.md was not walked (vanished or unreadable), so nothing would upload.
    else if (!skill.files.some((file) => file.relPath === 'SKILL.md'))
      skipped.push({ name: skill.name, reason: 'unreadable' })
    else if (foreignNames.has(skill.name)) skipped.push({ name: skill.name, reason: 'name_taken' })
    else if (size > MAX_SYNCED_SKILL_BYTES) skipped.push({ name: skill.name, reason: 'too_large' })
    else candidates.push({ name: skill.name, files: kept, bytes: size })
  }

  // Smallest first fits the most skills; ties by name keep the choice stable
  // between passes so a skill does not flap in and out of the store.
  candidates.sort((a, b) => a.bytes - b.bytes || a.name.localeCompare(b.name))
  const synced: SkillSyncPlan['synced'] = []
  const uploads: SkillSyncPlan['uploads'] = []
  const deleteKeys: string[] = []

  for (const skill of candidates) {
    if (
      files + skill.files.length > RUNTIME_FILE_BUDGET ||
      bytes + skill.bytes > RUNTIME_BYTE_BUDGET
    ) {
      skipped.push({ name: skill.name, reason: 'over_budget' })
      continue
    }
    files += skill.files.length
    bytes += skill.bytes
    synced.push(skill.name)
    const before = managed[skill.name] ?? {}
    const current = new Set(skill.files.map((file) => file.relPath))

    for (const file of skill.files) {
      const key = skillKey(skill.name, file.relPath)

      if (before[file.relPath] !== file.sha256 || !remoteKeys.has(key)) {
        uploads.push({ name: skill.name, file, key })
      }
    }
    for (const relPath of Object.keys(before)) {
      const key = skillKey(skill.name, relPath)

      if (!current.has(relPath) && remoteKeys.has(key)) deleteKeys.push(key)
    }
  }

  const keep = new Set(synced)
  const deleteSkills = Object.keys(managed)
    .filter((name) => !keep.has(name))
    .toSorted((a, b) => a.localeCompare(b))

  return { synced, uploads, deleteKeys, deleteSkills, skipped }
}

export const INSTRUCTION_TITLE = 'CLAUDE.md from this computer'

/**
 * CLAUDE.md as personal Instruction contents: split at line breaks into parts no
 * longer than `maxChars`, a single over-long line hard-wrapped. Empty when the
 * file has nothing in it.
 */
export function splitInstruction(markdown: string, maxChars: number): string[] {
  const parts: string[] = []
  let current = ''

  for (const line of markdown.trim().split('\n')) {
    let rest = line

    while (rest.length > maxChars) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      parts.push(rest.slice(0, maxChars))
      rest = rest.slice(maxChars)
    }
    const next = current ? `${current}\n${rest}` : rest

    if (next.length > maxChars) {
      if (current.trim()) parts.push(current.trim())
      current = rest
    } else current = next
  }
  if (current.trim()) parts.push(current.trim())

  return parts
}

export function instructionTitle(index: number, count: number): string {
  return count > 1
    ? `${INSTRUCTION_TITLE} (${String(index + 1)} of ${String(count)})`
    : INSTRUCTION_TITLE
}
