import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

import type { LocalEntry } from './types'

function guessContentType(name: string): string | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    xml: 'application/xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    log: 'text/plain',
  }

  return map[ext]
}

// OS-generated metadata that should never be uploaded — they're noise in the
// agent's view and bloat the transfer. Matched by exact name (files) or as a
// directory to skip wholesale (`__MACOSX`).
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized'])
const JUNK_DIRS = new Set(['__MACOSX'])

export function stripTrailingSeparators(p: string): string {
  let end = p.length

  while (end > 0 && (p[end - 1] === '/' || p[end - 1] === '\\')) end--

  return p.slice(0, end)
}

// Expand the picked paths into a flat file list. A directory is walked
// recursively and its files keep a `<dirname>/<relative>` relPath so the
// structure survives a later download/zip; a plain file maps to its basename.
export async function collectEntries(paths: string[]): Promise<LocalEntry[]> {
  const out: LocalEntry[] = []

  async function walk(dir: string, relBase: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const e of entries) {
      if (JUNK_NAMES.has(e.name) || (e.isDirectory() && JUNK_DIRS.has(e.name))) continue
      const full = join(dir, e.name)
      const rel = `${relBase}/${e.name}`

      if (e.isDirectory()) {
        await walk(full, rel)
      } else if (e.isFile()) {
        const st = await fs.stat(full)

        out.push({
          path: full,
          relPath: rel,
          fileName: e.name,
          size: st.size,
          contentType: guessContentType(e.name) ?? null,
        })
      }
    }
  }
  for (const p of paths) {
    const st = await fs.stat(p)

    if (st.isDirectory()) {
      await walk(p, basename(stripTrailingSeparators(p)))
    } else if (st.isFile()) {
      const name = basename(p)

      out.push({
        path: p,
        relPath: name,
        fileName: name,
        size: st.size,
        contentType: guessContentType(name) ?? null,
      })
    }
  }

  return out
}

// Name the transport archive after what was picked: a single folder keeps its
// own name; anything else (multiple picks) falls back to the label or a generic.
export function deriveArchiveName(filePaths: string[], singleDir: boolean, label?: string): string {
  if (singleDir) return `${basename(stripTrailingSeparators(filePaths[0]))}.zip`
  if (label) return `${label.replace(/[\\/:*?"<>|]+/g, '_')}.zip`

  return 'attachments.zip'
}
