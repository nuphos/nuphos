import { pathToFileURL } from 'node:url'

/** The backend may run on POSIX while the attachment lives on a Windows computer. */
export function attachmentFileUrl(path: unknown): string | undefined {
  if (typeof path !== 'string' || path.includes('\0')) return undefined
  const windows = /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path)

  if (!windows && !path.startsWith('/')) return undefined

  return pathToFileURL(path, { windows }).href
}
