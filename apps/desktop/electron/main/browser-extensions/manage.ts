// Installing, loading, updating and removing the user's extensions, each step
// that adds access or deletes data asked first.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { BrowserWindow, session } from 'electron'

import { showAppDialog } from '../../app-dialog.ts'

import {
  checkInstalled,
  compareVersions,
  downloadExtension,
  extensionsRoot,
  installedVersions,
  isExtensionId,
  latestVersion,
  pruneVersions,
  writeExtension,
} from './store.ts'
import { addedAccess, installWarnings } from './warnings.ts'

import type { ExtensionManifest } from './warnings.ts'

export const BROWSER_PARTITION = 'persist:browser'

export const browserSession = () => session.fromPartition(BROWSER_PARTITION)

/** Extensions not loaded because their files differ from the Web Store's, with the reason. */
export const failed = new Map<string, { name: string; error: string }>()
export const pinned = new Set<string>()
const declinedUpdates = new Set<string>()

const pinsFile = () => path.join(extensionsRoot(), 'pinned.json')

export function notifyChanged() {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send('browser-extensions:changed')
}

/** A question from the main process, so no page or renderer can answer it. */
export function confirm(title: string, message: string, lines: string[], confirmLabel: string) {
  return showAppDialog(
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    {
      title,
      message,
      detail: lines.map((line) => (line.endsWith(':') ? line : `• ${line}`)).join('\n'),
      confirmLabel,
    },
  )
}

export async function setPinned(id: string, pin: boolean) {
  if (pin) pinned.add(id)
  else pinned.delete(id)
  await writeFile(pinsFile(), JSON.stringify([...pinned])).catch(() => {
    // Pins are a preference; the toolbar still shows the change until restart.
  })
  notifyChanged()
}

async function installedName(id: string, version: string) {
  try {
    const record = JSON.parse(
      await readFile(path.join(extensionsRoot(), id, `${version}.json`), 'utf8'),
    ) as { manifest: string }
    const manifest = JSON.parse(
      Buffer.from(record.manifest, 'base64').toString('utf8'),
    ) as ExtensionManifest

    return manifest.name ?? id
  } catch {
    return id
  }
}

/** Loads the newest version of each extension that passes its check, and the pins. */
export async function loadInstalled() {
  const saved = await readFile(pinsFile(), 'utf8')
    .then((text) => (JSON.parse(text) as unknown[]).filter(isExtensionId))
    .catch((): string[] => [])

  for (const id of saved) pinned.add(id)
  for (const [id, versions] of await installedVersions()) {
    let error = ''

    for (const version of versions) {
      try {
        await browserSession().extensions.loadExtension(await checkInstalled(id, version))
        await pruneVersions(id, version)
        error = ''
        break
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      }
    }
    if (error) {
      console.error(`[browser-extensions] ${id} not loaded:`, error)
      failed.set(id, { name: await installedName(id, versions[0]), error })
    }
  }
  notifyChanged()
}

/** Asks with Chrome's warnings, then installs and loads the Web Store's latest version of `id`. */
export async function install(id: string): Promise<boolean> {
  if (browserSession().extensions.getExtension(id)) return true
  const download = await downloadExtension(id)
  const name = download.manifest.name ?? id
  const allowed = await confirm(
    'Add extension',
    `Add "${name}"?`,
    ['It can:', ...installWarnings(download.manifest)],
    'Add extension',
  )

  if (!allowed) return false
  await pruneVersions(id)
  failed.delete(id)
  await writeExtension(download)
  await browserSession().extensions.loadExtension(await checkInstalled(id, download.version))
  notifyChanged()

  return true
}

export async function remove(id: string): Promise<boolean> {
  const extensions = browserSession().extensions
  const name = extensions.getExtension(id)?.name ?? failed.get(id)?.name ?? id
  const allowed = await confirm(
    'Remove extension',
    `Remove "${name}"?`,
    ['The extension and its data in the Nuphos browser are deleted.'],
    'Remove',
  )

  if (!allowed) return false
  if (extensions.getExtension(id)) extensions.removeExtension(id)
  failed.delete(id)
  await pruneVersions(id)
  await setPinned(id, false)

  return true
}

/**
 * Downloads newer versions. One that reaches further waits for a yes; on no the
 * current version stays. A new version loads at the next launch, never under a
 * running extension.
 */
export async function checkForUpdates() {
  for (const extension of browserSession().extensions.getAllExtensions()) {
    try {
      const latest = await latestVersion(extension.id, extension.version)

      if (!latest || compareVersions(latest, extension.version) <= 0) continue
      if (declinedUpdates.has(`${extension.id}@${latest}`)) continue
      const download = await downloadExtension(extension.id)

      if (compareVersions(download.version, extension.version) <= 0) continue
      const added = addedAccess(extension.manifest as ExtensionManifest, download.manifest)
      const allowed =
        added.length === 0 ||
        (await confirm(
          'Extension update',
          `"${extension.name}" wants more access`,
          ['The update can also:', ...added],
          'Update',
        ))

      if (allowed) await writeExtension(download)
      else declinedUpdates.add(`${extension.id}@${download.version}`)
    } catch (error) {
      console.error(`[browser-extensions] update of ${extension.id} failed:`, error)
    }
  }
}
