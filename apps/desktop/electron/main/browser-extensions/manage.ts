// Installing, loading, updating and removing the user's extensions, each step
// that adds access or deletes data asked first.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { BrowserWindow, session } from 'electron'

import { showAppDialog } from '../../app-dialog.ts'

import { logError } from './log.ts'
import {
  checkInstalled,
  compareVersions,
  downloadExtension,
  extensionsRoot,
  installedVersions,
  latestVersion,
  pruneVersions,
  writeExtension,
} from './store.ts'
import { addedAccess, extensionName, installWarnings } from './warnings.ts'

import type { ExtensionManifest } from './warnings.ts'

export const BROWSER_PARTITION = 'persist:browser'

export const browserSession = () => session.fromPartition(BROWSER_PARTITION)

/** Extensions not loaded because their files differ from the Web Store's, with the reason. */
export const failed = new Map<string, { name: string; error: string }>()
const declinedUpdates = new Set<string>()

/** Tells the app's windows (not extension windows) to reload the toolbar. */
export function notifyChanged() {
  for (const { webContents } of BrowserWindow.getAllWindows())
    if (!webContents.isDestroyed() && webContents.session !== browserSession())
      webContents.send('browser-extensions:changed')
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

/** Loads the newest version of each extension that passes its check. */
export async function loadInstalled() {
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
      logError(`${id} not loaded:`, error)
      failed.set(id, { name: await installedName(id, versions[0]), error })
    }
  }
  notifyChanged()
}

/** Extensions with an install under way; a second request for one waits for nothing and says no. */
const installing = new Set<string>()

/** Asks with Chrome's warnings, then installs and loads the Web Store's latest version of `id`. */
export async function install(id: string): Promise<boolean> {
  if (browserSession().extensions.getExtension(id)) return true
  if (installing.has(id)) return false
  installing.add(id)
  try {
    const download = await downloadExtension(id)
    const allowed = await confirm(
      'Add extension',
      `Add "${extensionName(download.manifest, download.files)}"?`,
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
  } finally {
    installing.delete(id)
  }
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
      logError(`update of ${extension.id} failed:`, error)
    }
  }
}
