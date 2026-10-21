import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

import { buildAtlasError } from '../atlas/error.ts'

const LIMIT = 512 * 1024

// A path in a chat message does not say which machine it is on, so a linked
// file is looked up on this computer first and the agent's workspace second.
// `/workspace/…` (how the renderer writes a relative link) resolves against
// this computer's working directory, the local agent's workspace, and must
// stay inside it; without one, only explicit absolute paths are tried here.
// Missing files and directories fall through to the agent. A local file over
// the inline limit stays local and uses the media/download transfer instead.
export async function readThisComputerFile(
  path: string,
  workspace: string | null,
): Promise<{ name: string; size: number; data: string } | null> {
  const target = await resolveThisComputerFile(path, workspace)

  if (!target) return null
  const tooLarge = () => buildAtlasError('File preview is limited to 512 KiB.', 'file_too_large')

  if ((await stat(target)).size > LIMIT) throw tooLarge()
  const data = await readFile(target)

  if (data.length > LIMIT) throw tooLarge()

  return { name: basename(target), size: data.length, data: data.toString('base64') }
}

/** Where a linked path is on this computer, if it is a file there. */
export async function resolveThisComputerFile(
  path: string,
  workspace: string | null,
): Promise<string | null> {
  const inWorkspace = path === '/workspace' || path.startsWith('/workspace/')

  if (inWorkspace && !workspace) return null
  const target =
    inWorkspace && workspace ? resolve(workspace, `.${path.slice('/workspace'.length)}`) : path
  const outside = workspace ? relative(workspace, target) : ''

  if (inWorkspace && (outside.startsWith('..') || isAbsolute(outside))) return null
  const info = await stat(target).catch(() => null)

  return info?.isFile() ? target : null
}
