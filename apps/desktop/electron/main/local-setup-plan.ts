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
export type LocalSkillSnapshot = {
  name: string
  files: LocalSkillFile[]
  /** A walk cap stopped before the whole skill was seen. */
  truncated?: boolean
  /** It links outside its folder in a way the member has not reviewed: not read. */
  unreviewed?: boolean
}
export type RemoteObject = { key: string; size: number }

export type SkippedSkill = {
  name: string
  reason:
    | 'too_large'
    | 'too_many_files'
    | 'name_taken'
    | 'over_budget'
    | 'unreadable'
    | 'needs_review'
    | 'name_clash'
  /** For `name_clash`: the folder whose copy stays here, and the earlier one that syncs. */
  folder?: string
  syncedFrom?: string
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

/** Why `skill` stays on this computer this pass, or null when it can sync. */
function skipReason(
  skill: LocalSkillSnapshot,
  size: number,
  foreignNames: ReadonlySet<string | null>,
): SkippedSkill['reason'] | null {
  if (skill.unreviewed) return 'needs_review'
  // The walk stops at 200 files or 5,000 entries, possibly before reaching
  // SKILL.md, so that comes first: a partial list must never drive deletions.
  if (skill.truncated || skill.files.length >= MAX_SYNCED_SKILL_FILES) return 'too_many_files'
  // A file could not be read, or SKILL.md vanished, so nothing would upload.
  if (!skill.files.some((file) => file.relPath === 'SKILL.md')) return 'unreadable'
  if (foreignNames.has(skill.name)) return 'name_taken'
  if (size > MAX_SYNCED_SKILL_BYTES) return 'too_large'

  return null
}

const HELD = new Set<SkippedSkill['reason']>(['unreadable', 'needs_review'])

/**
 * Skills synced before that this pass did not read: a file failed to read, which
 * is likely passing (permissions, a link being re-pointed), or a link waits for
 * the member's review. Each keeps its copy and record as they are, and the copy
 * still counts against the budget.
 */
function heldSkills(
  skipped: readonly SkippedSkill[],
  managed: Readonly<Record<string, unknown>>,
  remote: readonly RemoteObject[],
): { names: Set<string>; files: number; bytes: number } {
  const names = new Set(
    skipped
      .filter((skip) => HELD.has(skip.reason) && skip.name in managed)
      .map((skip) => skip.name),
  )
  const objects = remote.filter((object) => names.has(skillOfKey(object.key) ?? ''))

  return {
    names,
    files: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.size, 0),
  }
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

    const reason = skipReason(skill, size, foreignNames)

    if (reason) skipped.push({ name: skill.name, reason })
    else candidates.push({ name: skill.name, files: kept, bytes: size })
  }

  const held = heldSkills(skipped, managed, remote)

  files += held.files
  bytes += held.bytes

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

  const keep = new Set([...synced, ...held.names])
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
