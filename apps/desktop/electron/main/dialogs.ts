import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { app, BrowserWindow, dialog } from 'electron'

import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'

export type PastedAttachmentPayload = {
  paths?: string[]
  files?: { name?: string; type?: string; bytes: ArrayBuffer | Uint8Array | number[] }[]
}

// Electron 43 changed an open dialog with no `defaultPath` to start in
// Downloads rather than wherever the user last browsed. Attaching to a project
// is a repeat action against the same few directories, so carry the last pick
// forward ourselves instead of sending them back to Downloads every time.
let lastPickedDirectory: string | undefined

export async function pickPaths(
  e: IpcMainInvokeEvent,
  properties: OpenDialogOptions['properties'],
): Promise<string[]> {
  const parentWindow = BrowserWindow.fromWebContents(e.sender)
  const options: OpenDialogOptions = { properties, defaultPath: lastPickedDirectory }
  const result =
    parentWindow && !parentWindow.isDestroyed()
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)

  if (result.canceled) return []
  const [first] = result.filePaths

  if (first) {
    lastPickedDirectory = properties?.includes('openDirectory') ? first : path.dirname(first)
  }

  return result.filePaths
}

function safePastedFileName(
  name: string | null | undefined,
  type: string | null | undefined,
  index: number,
): string {
  const trimmed = name?.trim()
  const fallbackExt =
    type === 'image/png'
      ? '.png'
      : type === 'image/jpeg'
        ? '.jpg'
        : type === 'image/gif'
          ? '.gif'
          : ''
  const fallback = `pasted-${String(index + 1)}${fallbackExt}`

  return (trimmed || fallback).replace(/[/:\\]/g, '-')
}

async function uniqueDestinationPath(dir: string, baseName: string): Promise<string> {
  const parsed = path.parse(baseName)

  for (let i = 0; i < 1000; i += 1) {
    const candidateName = i === 0 ? baseName : `${parsed.name}-${String(i)}${parsed.ext}`
    const candidate = path.join(dir, candidateName)

    if (!fsSync.existsSync(candidate)) return candidate
  }
  throw new Error(`Unable to allocate pasted attachment path for ${baseName}`)
}

async function ensurePastedAttachmentDir(): Promise<string> {
  const root = path.join(app.getPath('userData'), 'pasted-attachments')

  await fs.mkdir(root, { recursive: true })

  return root
}

export async function savePastedAttachments(payload: PastedAttachmentPayload): Promise<string[]> {
  const paths =
    payload.paths?.filter((value) => typeof value === 'string' && value.length > 0) ?? []
  const files = payload.files ?? []

  if (paths.length === 0 && files.length === 0) return []

  const dir = await ensurePastedAttachmentDir()
  const out: string[] = []

  for (const sourcePath of paths) {
    const baseName = safePastedFileName(path.basename(sourcePath), null, out.length)
    const dest = await uniqueDestinationPath(dir, baseName)

    await fs.cp(sourcePath, dest, { recursive: true, force: false, errorOnExist: true })
    out.push(dest)
  }

  for (const file of files) {
    const baseName = safePastedFileName(file.name, file.type, out.length)
    const dest = await uniqueDestinationPath(dir, baseName)
    const bytes =
      file.bytes instanceof Uint8Array
        ? file.bytes
        : Array.isArray(file.bytes)
          ? Uint8Array.from(file.bytes)
          : new Uint8Array(file.bytes)

    await fs.writeFile(dest, bytes)
    out.push(dest)
  }

  return out
}
