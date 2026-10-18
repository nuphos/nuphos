import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

const LIMIT = 512 * 1024

// A path in a chat message does not say which machine it is on, so a linked
// file is looked up on this computer first and the agent's workspace second.
// `/workspace/…` (how the renderer writes a relative link) resolves against
// this computer's working directory, the local agent's workspace, and must
// stay inside it; without one, only explicit absolute paths are tried here.
// Anything not readable here (missing, a directory, over the preview limit)
// falls through to the agent.
export async function readThisComputerFile(
  path: string,
  workspace: string | null,
): Promise<{ name: string; size: number; data: string } | null> {
  const target = await resolveThisComputerFile(path, workspace)
  const data = target && (await stat(target)).size <= LIMIT ? await readFile(target) : null

  return target && data
    ? { name: basename(target), size: data.length, data: data.toString('base64') }
    : null
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
