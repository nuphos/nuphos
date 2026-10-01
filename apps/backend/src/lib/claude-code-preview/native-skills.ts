import { createHash } from 'node:crypto'

import { collectSkillFiles } from '@/lib/agent/skill-store/inject'
import { resolveSkillsDirectory } from '@/lib/agent/skill-store/merge'
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

/**
 * The complete merged builtin/global/team skill tree for Claude Code's native
 * discovery. The classic `plan` skill is intentionally omitted: Claude Code
 * reserves that name for its /plan UI command. `nuphos-plan` is the native,
 * script-backed equivalent.
 */
export async function nativeSkillBundle(
  teamId: string,
): Promise<{ revision: string; files: NativeSkillFile[] }> {
  const directory = await resolveSkillsDirectory(teamId)
  const files = nativeSkillFiles(await collectSkillFiles(directory)).toSorted((a, b) =>
    byCodeUnit(a.path, b.path),
  )

  return { revision: revisionOf(files), files }
}
