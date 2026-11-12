import { AppError } from '@/lib/errors'

import { parseGithubSource } from './source'

import type { fetchRepoArchive } from './install'
import type { Tracked } from './updates'

/** The commit to download for one source: its ref, or the commit the member reviewed. */
function pinnedRef(tracked: Tracked[], pins: Record<string, string> | null): string | null {
  const first = tracked[0]?.origin

  if (!pins) return first?.ref ?? null
  const shas = new Set(tracked.map(({ origin }) => pins[origin.name]))
  const [sha] = shas

  if (shas.size !== 1 || !sha)
    throw new AppError(
      400,
      'invalid_input',
      'Send the reviewed commit of every skill from a source',
    )

  return sha
}

export async function downloadFor(
  tracked: Tracked[],
  pins: Record<string, string> | null,
  download: typeof fetchRepoArchive,
) {
  const [first] = tracked

  if (!first) return null
  const ref = pinnedRef(tracked, pins)

  try {
    const archive = await download(parseGithubSource(first.origin.repo), ref)

    if (pins && archive.commitSha !== ref)
      throw new AppError(
        409,
        'source_changed',
        'Repository archive does not match the reviewed commit',
      )

    return archive
  } catch (err) {
    if (!pins && err instanceof AppError && err.code === 'source_not_found') return null
    throw err
  }
}
