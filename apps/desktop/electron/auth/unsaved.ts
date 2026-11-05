import path from 'node:path'

import { DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

/**
 * Why a new sign-in could not be kept, when the person can fix it: the folder
 * for the sign-in file is not theirs to write (a `~/.config` made by root, say).
 * Null for anything else, which keeps its own message.
 */
export function unsavedReason(e: unknown): string | null {
  const code = (e as NodeJS.ErrnoException | null)?.code

  if (code !== 'EACCES' && code !== 'EPERM') return null

  return `Nuphos couldn't save your sign-in: ${path.dirname(DESKTOP_CONFIG_PATH)} isn't writable (permission denied).`
}
