import {
  copyFileSync,
  lstatSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from 'node:fs'
import path from 'node:path'

/**
 * Windows shares the owner's Codex login into an agent's home. A junction holds directories
 * only, so it is a file symlink where Windows allows one (Developer Mode or an administrator),
 * and Codex then writes the owner's file itself. Codex refuses to save over a hard link, so
 * otherwise it is a copy: a newer login or token refresh made here is copied back to the owner
 * first, since a refresh token works only once. The owner's login wins; one made here stays
 * while the owner has none, or while the owner's cannot be shared here.
 */
export function linkOwnerFile(ownerHome: string, home: string, file: string): void {
  const link = path.join(home, file)
  const target = path.join(ownerHome, file)
  const owner = statSync(target, { throwIfNoEntry: false })
  const existing = lstatSync(link, { throwIfNoEntry: false })

  // Share beside the file first, so a failure leaves the current login in place.
  const next = `${link}.${String(process.pid)}.tmp`

  try {
    // Made again each time: earlier builds left a junction here, which Codex cannot read.
    if (existing?.isSymbolicLink()) unlinkSync(link)
    else if (existing && !owner) return
    if (!owner?.isFile()) return
    if (existing?.isFile() && existing.mtimeMs > owner.mtimeMs) copyFileSync(link, target)
    rmSync(next, { force: true })
    try {
      symlinkSync(target, next, 'file')
    } catch {
      copyFileSync(target, next)
      // As old as the owner's, so only a save made here later counts as newer.
      const { atime, mtime } = statSync(target)

      utimesSync(next, atime, mtime)
    }
    renameSync(next, link)
  } catch {
    // A file in use: the current login stays, or Codex runs signed out.
    rmSync(next, { force: true })
  }
}
