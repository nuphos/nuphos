import { createHash } from 'node:crypto'

import { collectSkillFiles } from '@/lib/agent/skill-store/inject'
import { mergedSkillsFingerprint, resolveSkillsDirectory } from '@/lib/agent/skill-store/merge'
import { safeJoinUnder } from '@/lib/agent/skill-store/safe-path'
import { personalSkillsScope } from '@/lib/agent/skill-store/service'
import {
  getScopeCacheDir,
  getScopeSyncRevision,
  isSkillsStoreConfigured,
  syncScope,
} from '@/lib/agent/skill-store/sync'
import { byCodeUnit } from '@/lib/agent/sort-order'
import { AppError } from '@/lib/errors'

export type NativeSkillFile = {
  path: string
  contentBase64: string
  executable: boolean
}

const MAX_RUNTIME_SKILL_FILES = 2_000
const MAX_RUNTIME_SKILL_BYTES = 32 * 1024 * 1024

export function nativeSkillFiles(files: { relPath: string; content: Buffer }[]): NativeSkillFile[] {
  const selected = files.filter((file) => {
    const root = file.relPath.split('/', 1)[0]

    // `plan` collides with Claude Code's /plan UI command. The native,
    // script-backed equivalent is installed as `nuphos-plan`.
    return root !== 'plan'
  })
  const totalBytes = selected.reduce((total, file) => total + file.content.byteLength, 0)

  if (selected.length > MAX_RUNTIME_SKILL_FILES || totalBytes > MAX_RUNTIME_SKILL_BYTES) {
    throw new AppError(
      413,
      'runtime_skills_too_large',
      'Merged native skills exceed the runtime sync limit',
    )
  }

  return selected.map((file) => ({
    path: file.relPath,
    contentBase64: file.content.toString('base64'),
    executable: file.relPath.includes('/scripts/'),
  }))
}

function revisionOf(files: NativeSkillFile[]): string {
  const hash = createHash('sha256')

  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.contentBase64)
    hash.update('\0')
  }

  return hash.digest('hex')
}

export type NativeSkillBundle = { revision: string; files: NativeSkillFile[] }

/**
 * A bundle's revision, and its contents on demand. Reading and hashing a tree
 * takes seconds while a runtime already holds it almost every time, so the
 * revision is remembered against the sync state of the tree's inputs and a
 * runtime that holds it is answered without reading a file.
 */
export type SkillBundle = { revision: string; read: () => Promise<NativeSkillBundle> }

const revisions = new Map<string, { inputs: string; revision: string }>()

async function bundleOf(key: string, inputs: string, directory: string): Promise<SkillBundle> {
  const read = async () => {
    const files = nativeSkillFiles(await collectSkillFiles(directory)).toSorted((a, b) =>
      byCodeUnit(a.path, b.path),
    )
    const bundle = { revision: revisionOf(files), files }

    revisions.set(key, { inputs, revision: bundle.revision })

    return bundle
  }
  const known = revisions.get(key)

  if (known?.inputs === inputs) return { revision: known.revision, read }
  const bundle = await read()

  return { revision: bundle.revision, read: () => Promise.resolve(bundle) }
}

/**
 * The complete merged builtin/global/team skill tree for Claude Code's native
 * discovery. The classic `plan` skill is intentionally omitted: Claude Code
 * reserves that name for its /plan UI command. `nuphos-plan` is the native,
 * script-backed equivalent.
 */
export async function nativeSkillBundle(teamId: string): Promise<SkillBundle> {
  const directory = await resolveSkillsDirectory(teamId)

  return bundleOf(`team:${teamId}`, await mergedSkillsFingerprint(teamId), directory)
}

/**
 * One member's personal skills in one team, on their own. The runtime installs
 * them in the conversation's directory, beside the shared team tree rather than
 * in it, so they reach only the turns that member starts.
 */
export async function personalSkillBundle(teamId: string, userId: string): Promise<SkillBundle> {
  const scope = personalSkillsScope(teamId, userId)

  if (isSkillsStoreConfigured()) {
    try {
      await syncScope(scope)
    } catch {
      // Serve the last cached revision when the store is transiently unavailable.
    }
  }

  return bundleOf(
    `personal:${scope}`,
    String(await getScopeSyncRevision(scope)),
    safeJoinUnder(getScopeCacheDir(scope), 'skills'),
  )
}
