import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { buildAtlasError } from '../atlas/error.ts'

const LIMIT = 512 * 1024

// A path in a chat message does not say which machine it is on, so a linked
// file is looked up on this computer first and the agent's workspace second.
// Each side resolves `/workspace/…` (how the renderer writes a relative link)
// against its own working directory: here, the local agent's workspace.
export async function readThisComputerFile(
  path: string,
  workspace: string | null,
): Promise<{ name: string; size: number; data: string } | null> {
  const base = workspace ?? homedir()
  const target =
    path === '/workspace' || path.startsWith('/workspace/')
      ? join(base, path.slice('/workspace'.length))
      : resolve(base, path)
  const info = await stat(target).catch(() => null)

  if (!info?.isFile()) return null
  if (info.size > LIMIT)
    throw buildAtlasError('File preview is limited to 512 KiB.', 'file_too_large')
  const data = await readFile(target)

  return { name: basename(target), size: data.length, data: data.toString('base64') }
}
