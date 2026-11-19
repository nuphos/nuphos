import {
  copyFileSync,
  linkSync,
  lstatSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'

/**
 * Windows links the owner's Codex login into an agent's home. A junction holds directories
 * only, so it is a file symlink where Windows allows one (Developer Mode or an administrator),
 * and Codex then writes the owner's file itself. Otherwise it is a hard link, which Codex
 * breaks: it saves auth.json by renaming a new file over it. A newer login or token refresh
 * made here is therefore copied back before linking again, since a refresh token works only
 * once. The owner's login wins; one made here stays while the owner has none, or while the
 * owner's cannot be linked here.
 */
export function linkOwnerFile(ownerHome: string, home: string, file: string): void {
  const link = path.join(home, file)
  const target = path.join(ownerHome, file)
  const owner = statSync(target, { throwIfNoEntry: false })
  const existing = lstatSync(link, { throwIfNoEntry: false })

  // Link beside the file first, so a link that cannot be made leaves the current login in place.
  const next = `${link}.${String(process.pid)}.tmp`

  try {
    // Made again each time: earlier builds left a junction here, which Codex cannot read.
    if (existing?.isSymbolicLink()) unlinkSync(link)
    else if (existing && (!owner || owner.ino === existing.ino)) return
    if (!owner?.isFile()) return
    if (existing?.isFile() && existing.mtimeMs > owner.mtimeMs) copyFileSync(link, target)
    rmSync(next, { force: true })
    try {
      symlinkSync(target, next, 'file')
    } catch {
      linkSync(target, next)
    }
    renameSync(next, link)
  } catch {
    // Another volume, or a file in use: the current login stays, or Codex runs signed out.
    rmSync(next, { force: true })
  }
}
