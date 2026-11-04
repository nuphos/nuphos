// Chrome Web Store extensions on disk: download, check, install, load, update.
//
// <userData>/browser-extensions/<id>/<version>/       the extension's files
// <userData>/browser-extensions/<id>/<version>.json   its record: the signed hashes,
//                                                     the original manifest and the key
//
// A version is installed once its record exists. Every load checks every file
// against the Web Store's signed hashes first.
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { app, net } from 'electron'

import { readCrx } from './crx.ts'
import { checkFiles, readVerifiedContents, VERIFIED_CONTENTS_PATH } from './verified-contents.ts'

import type { ExtensionManifest } from './warnings.ts'

const EXTENSION_ID = /^[a-p]{32}$/
const VERSION = /^\d+(\.\d+){0,3}$/

type InstallRecord = { verifiedContents: string; manifest: string; key: string }

/** A downloaded and checked extension, not yet on disk. */
export type Download = {
  id: string
  version: string
  manifest: ExtensionManifest
  files: Record<string, Uint8Array>
  record: InstallRecord
}

export const extensionsRoot = () => path.join(app.getPath('userData'), 'browser-extensions')

export const isExtensionId = (id: unknown): id is string =>
  typeof id === 'string' && EXTENSION_ID.test(id)

/** -1, 0 or 1, comparing dotted versions number by number. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)

    if (diff !== 0) return Math.sign(diff)
  }

  return 0
}

/**
 * Throws unless `files` are the Web Store's signed files of `id`. Returns the
 * signed version and the manifest.
 */
function check(id: string, verifiedContents: string, files: Record<string, Uint8Array>) {
  const signed = readVerifiedContents(verifiedContents)

  if (signed.id !== id) throw new Error(`The signed hashes belong to ${signed.id}, not ${id}`)
  checkFiles(signed, files)
  const manifestBytes = files['manifest.json']

  if (!manifestBytes) throw new Error('The extension has no manifest.json')
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ExtensionManifest

  if (manifest.version !== signed.version || !VERSION.test(signed.version))
    throw new Error('The manifest version differs from the signed version')

  return { version: signed.version, manifest, manifestBytes }
}

/** The latest Web Store version of `id`, downloaded and checked. */
export async function downloadExtension(id: string): Promise<Download> {
  const url = new URL('https://clients2.google.com/service/update2/crx')

  url.searchParams.set('response', 'redirect')
  url.searchParams.set('acceptformat', 'crx3')
  url.searchParams.set('prodversion', process.versions.chrome)
  url.searchParams.set('x', `id=${id}&installsource=ondemand&uc`)
  const response = await net.fetch(url.href)

  if (!response.ok) throw new Error(`The Chrome Web Store answered ${String(response.status)}`)
  const { key, files } = readCrx(new Uint8Array(await response.arrayBuffer()), id)
  const verifiedContents = files[VERIFIED_CONTENTS_PATH]

  if (!verifiedContents) throw new Error('The extension has no Web Store hashes')
  const text = new TextDecoder().decode(verifiedContents)
  const { version, manifest, manifestBytes } = check(id, text, files)

  return {
    id,
    version,
    manifest,
    files,
    record: {
      verifiedContents: text,
      manifest: Buffer.from(manifestBytes).toString('base64'),
      key,
    },
  }
}

/** The manifest Electron loads: the signed one plus the key that gives the Web Store ID. */
const manifestOnDisk = (record: InstallRecord) =>
  JSON.stringify(
    { ...JSON.parse(Buffer.from(record.manifest, 'base64').toString('utf8')), key: record.key },
    null,
    2,
  )

/** Writes a checked download in place. Its record goes last, so a half-written version is never loaded. */
export async function writeExtension(download: Download): Promise<string> {
  const dir = path.join(extensionsRoot(), download.id)
  const target = path.join(dir, download.version)
  const staging = path.join(dir, `.staging-${randomUUID()}`)

  try {
    for (const [file, data] of Object.entries(download.files)) {
      if (file.endsWith('/') || file.startsWith('_metadata/')) continue
      const destination = path.resolve(staging, file)

      if (!destination.startsWith(staging + path.sep)) throw new Error(`Unsafe path ${file}`)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, data)
    }
    await writeFile(path.join(staging, 'manifest.json'), manifestOnDisk(download.record))
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
    await writeFile(`${target}.json`, JSON.stringify(download.record))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  return target
}

/** Every regular file under `dir`, by `/`-separated relative path. Links and other kinds throw. */
async function readTree(dir: string, prefix = ''): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}

  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name

    if (relative === '_metadata') continue
    if (entry.isDirectory()) Object.assign(files, await readTree(dir, relative))
    else if (entry.isFile()) files[relative] = await readFile(path.join(dir, relative))
    else throw new Error(`${relative} is not a plain file`)
  }

  return files
}

/**
 * Checks an installed version against its signed hashes, puts its manifest
 * back to the signed one plus the key, and returns its folder. Throws on any
 * difference.
 */
export async function checkInstalled(id: string, version: string): Promise<string> {
  const dir = path.join(extensionsRoot(), id, version)

  if ((await lstat(dir)).isSymbolicLink()) throw new Error(`${dir} is a link`)
  const record = JSON.parse(await readFile(`${dir}.json`, 'utf8')) as InstallRecord
  const files = await readTree(dir)

  files['manifest.json'] = Buffer.from(record.manifest, 'base64')
  const checked = check(id, record.verifiedContents, files)

  if (checked.version !== version) throw new Error(`${dir} holds version ${checked.version}`)
  await writeFile(path.join(dir, 'manifest.json'), manifestOnDisk(record))

  return dir
}

/** Installed versions of each extension, newest first. */
export async function installedVersions(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  const ids = await readdir(extensionsRoot()).catch((): string[] => [])

  for (const id of ids.filter(isExtensionId)) {
    const entries = await readdir(path.join(extensionsRoot(), id)).catch((): string[] => [])
    const versions = entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((version) => VERSION.test(version) && entries.includes(version))
      .sort((a, b) => compareVersions(b, a))

    if (versions.length > 0) found.set(id, versions)
  }

  return found
}

/** Deletes every version of `id` except `keep`. */
export async function pruneVersions(id: string, keep?: string): Promise<void> {
  const dir = path.join(extensionsRoot(), id)

  if (!keep) {
    await rm(dir, { recursive: true, force: true })

    return
  }
  for (const name of await readdir(dir).catch((): string[] => []))
    if (name !== keep && name !== `${keep}.json`)
      await rm(path.join(dir, name), { recursive: true, force: true })
}

/** The latest version the Web Store offers for `id`, or null when it has none. */
export async function latestVersion(id: string, current: string): Promise<string | null> {
  const url = new URL('https://clients2.google.com/service/update2/crx')

  url.searchParams.set('response', 'updatecheck')
  url.searchParams.set('acceptformat', 'crx3')
  url.searchParams.set('prodversion', process.versions.chrome)
  url.searchParams.set('x', `id=${id}&v=${current}&uc`)
  const response = await net.fetch(url.href)

  if (!response.ok) return null
  const version = /<updatecheck\b[^>]*\bversion="([\d.]+)"/.exec(await response.text())?.[1]

  return version && VERSION.test(version) ? version : null
}
