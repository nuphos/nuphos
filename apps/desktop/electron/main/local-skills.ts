// Skills this computer already has: the directories Claude Code and Codex read
// from. Listing them, walking one and reading its files is all this module owns;
// uploading them is local-skill-import.ts and local-setup-sync.ts.
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Dirent, Stats } from 'node:fs'

/** `folder`: one the member added to Sync my setup. */
export type LocalSkillSource = 'claude' | 'codex' | 'folder'

export type LocalSkillInfo = {
  /** `<source>/<name>` — a name can exist under both agents. */
  id: string
  name: string
  source: LocalSkillSource
  path: string
  /** Where `path` resolves to when the skill's own entry is a link, else null. */
  linkedTo: string | null
  /** First line of the SKILL.md frontmatter `description`, when it has one. */
  description: string | null
  /** What an upload would send, so the member can review it first. */
  files: LocalSkillFileInfo[]
  fileCount: number
  totalBytes: number
  updatedAt: string
}

export type LocalSkillFileInfo = {
  relPath: string
  realPath: string
  size: number
  /** Reached through a link that leaves the skill's own resolved folder. */
  outside: boolean
}

/** A file the member saw before an upload, by where it really is. */
export type LocalSkillReviewedFile = { relPath: string; realPath: string }

export type LocalSkillEntry = {
  relPath: string
  /** The file itself, after links: read this, never `relPath` under the skill. */
  realPath: string
  size: number
  mtimeMs: number
  /** Identify the file the walk checked, so readSkillFile reads no other. */
  dev: number
  ino: number
}

/** The team skill store rejects anything larger, so skip it before uploading. */
export const MAX_SKILL_FILE_BYTES = 10_000_000
const MAX_FILES = 200
const MAX_DEPTH = 6
/** Entries examined per skill: aliased directories can fan out with no files to count. */
const MAX_ENTRIES = 5_000
const SKIP_ENTRIES = new Set(['.git', '.DS_Store', 'node_modules'])

/** Where Codex keeps its skills, the folder Sync my setup offers to add. */
export const codexSkillsDir = () => path.join(os.homedir(), '.agents', 'skills')

/** The `description:` of a SKILL.md, read from its leading frontmatter block. */
export function skillDescription(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(markdown)

  if (!match?.[1]) return null
  const line = match[1]
    .split(/\r?\n/u)
    .find((candidate) => /^description\s*:/iu.test(candidate))
    ?.replace(/^description\s*:/iu, '')
    .trim()
    .replace(/^['"]|['"]$/gu, '')
    .trim()

  return line ? line.slice(0, 300) : null
}

function isUnder(target: string, base: string): boolean {
  return target.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`)
}

type Resolved = { real: string; stat: Stats }

/** Where an entry really is and what it is, after any links (`cp -L`). */
async function resolveEntry(entry: Dirent, full: string): Promise<Resolved | null> {
  try {
    if (!entry.isSymbolicLink()) return { real: full, stat: await fs.lstat(full) }
    const real = await fs.realpath(full)

    return { real, stat: await fs.stat(real) }
  } catch {
    // Vanished between readdir and stat, or a dangling link: treat it as absent.
    return null
  }
}

/**
 * Every regular file under a skill directory, flattened to relative paths: what
 * Claude Code or Codex would read from it, so links are followed wherever they
 * point, like `cp -L`. Where that is outside the skill is not refused here but
 * shown before upload (LocalSkillFileInfo.outside). A link back to a directory
 * being walked is skipped, and depth, entries and files are capped.
 */
export async function localSkillEntries(root: string): Promise<LocalSkillEntry[]> {
  return (await walkSkill(root)).entries
}

/**
 * localSkillEntries, and whether a cap cut the walk short: a partial list must
 * not stand in for the whole skill, or sync would delete what it did not reach.
 */
export async function walkSkill(
  root: string,
): Promise<{ entries: LocalSkillEntry[]; truncated: boolean }> {
  const out: LocalSkillEntry[] = []
  const realRoot = await fs.realpath(root).catch(() => null)

  if (!realRoot) return { entries: out, truncated: false }
  let examined = 0

  // Each cap also stops descents already queued. A cycle is only `ancestors`,
  // not every directory seen: `assets -> scripts` must not hide `scripts/`.
  async function walk(dir: string, prefix: string, depth: number, ancestors: Set<string>) {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES || examined >= MAX_ENTRIES) return
    if (ancestors.has(dir)) return
    const lineage = new Set(ancestors).add(dir)
    let entries: Dirent[]

    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // A directory's own files before its subdirectories, so a branching tree
    // that exhausts the caps cannot crowd out a file nearer the root.
    const subdirs: { real: string; relPath: string }[] = []

    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES || examined >= MAX_ENTRIES) return
      examined += 1
      if (SKIP_ENTRIES.has(entry.name)) continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      const resolved = await resolveEntry(entry, path.join(dir, entry.name))

      if (resolved?.stat.isDirectory()) subdirs.push({ real: resolved.real, relPath })
      else if (resolved?.stat.isFile()) {
        const { size, mtimeMs, dev, ino } = resolved.stat

        out.push({ relPath, realPath: resolved.real, size, mtimeMs, dev, ino })
      }
    }
    for (const subdir of subdirs) await walk(subdir.real, subdir.relPath, depth + 1, lineage)
  }

  await walk(realRoot, '', 0, new Set())

  // SKILL.md first: it is the file the store keys the skill on, so a partial
  // upload still leaves a listable skill rather than orphan objects.
  const entries = out.toSorted((a, b) => {
    if (a.relPath === 'SKILL.md') return -1
    if (b.relPath === 'SKILL.md') return 1

    return a.relPath.localeCompare(b.relPath)
  })

  return { entries, truncated: out.length >= MAX_FILES || examined >= MAX_ENTRIES }
}

/** The files a link brings into `skill` from outside its folder, for review before sync. */
export function outsideFiles(skill: LocalSkillInfo) {
  return skill.files
    .filter((file) => file.outside)
    .map(({ relPath, realPath }) => ({ skill: skill.name, relPath, realPath }))
}

/** Whether a fresh walk found exactly the files the member reviewed, each where it was. */
export function matchesReview(
  entries: readonly LocalSkillReviewedFile[],
  reviewed: readonly LocalSkillReviewedFile[],
): boolean {
  const seen = new Set(reviewed.map((file) => `${file.relPath}\0${file.realPath}`))

  return (
    entries.length === seen.size &&
    entries.every((entry) => seen.has(`${entry.relPath}\0${entry.realPath}`))
  )
}

/**
 * A walked file's bytes, only while `realPath` is still that file: opened without
 * following a final link, then checked by device and inode (CERT POS35-C). One
 * over the size cap, or that changes size while being read, is refused rather
 * than uploaded cut short.
 */
export async function readSkillFile(entry: LocalSkillEntry): Promise<Buffer> {
  // Windows has no O_NOFOLLOW; the inode check below still catches a swap there.
  const noFollow = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0
  const handle = await fs.open(entry.realPath, constants.O_RDONLY | noFollow)

  try {
    const stat = await handle.stat()

    if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino) {
      throw new Error(`${entry.relPath} changed while it was being read`)
    }
    // To EOF, not to `stat.size`: some files (procfs) report 0 and still have content.
    let bytes = Buffer.alloc(Math.min(stat.size, MAX_SKILL_FILE_BYTES) + 1)
    let length = 0

    for (;;) {
      if (length === bytes.length) {
        if (length > MAX_SKILL_FILE_BYTES) throw new Error(`${entry.relPath} is larger than 10 MB`)
        bytes = Buffer.concat([
          bytes,
          Buffer.alloc(Math.min(length, MAX_SKILL_FILE_BYTES + 1 - length)),
        ])
      }
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)

      if (bytesRead === 0) break
      length += bytesRead
    }
    const after = await handle.stat()

    if (after.size !== stat.size || (stat.size > 0 && length !== stat.size)) {
      throw new Error(`${entry.relPath} changed while it was being read`)
    }

    return Buffer.from(bytes.subarray(0, length))
  } finally {
    await handle.close()
  }
}

async function describeSkill(
  source: LocalSkillSource,
  dir: string,
  name: string,
): Promise<LocalSkillInfo | null> {
  const root = path.join(dir, name)

  // Without a SKILL.md the directory is not a skill (the store keys on it too), nor walked.
  if (!(await fs.stat(path.join(root, 'SKILL.md')).catch(() => null))?.isFile()) return null
  const entries = await localSkillEntries(root)
  const skillMd = entries.find((entry) => entry.relPath === 'SKILL.md')

  // One the CLI could not read either: not a skill, and sync would fail on it.
  const markdown = skillMd && (await readSkillFile(skillMd).catch(() => null))

  if (!markdown) return null
  const realRoot = await fs.realpath(root).catch(() => root)
  // Only the entry itself: a linked home or skills directory would flag every skill.
  const isLink = (await fs.lstat(root).catch(() => null))?.isSymbolicLink() ?? false

  return {
    id: `${source}/${name}`,
    name,
    source,
    path: root,
    linkedTo: isLink ? realRoot : null,
    description: skillDescription(markdown.toString('utf8')),
    files: entries.map(({ relPath, realPath, size }) => ({
      relPath,
      realPath,
      size,
      outside: !isUnder(realPath, realRoot),
    })),
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    updatedAt: new Date(Math.max(0, ...entries.map((entry) => entry.mtimeMs))).toISOString(),
  }
}

/** The skills directly under `dir`: each a folder with a SKILL.md. */
export async function listSkillsIn(dir: string, source: LocalSkillSource) {
  const names = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const skills = await Promise.all(
    names
      // A linked root is fine: localSkillEntries walks where it resolves to.
      .filter(
        (entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry.name),
      )
      .map((entry) => describeSkill(source, dir, entry.name)),
  )

  return skills.filter((skill): skill is LocalSkillInfo => skill !== null)
}

export async function listLocalSkills(): Promise<LocalSkillInfo[]> {
  const found = await Promise.all([
    listSkillsIn(path.join(os.homedir(), '.claude', 'skills'), 'claude'),
    listSkillsIn(codexSkillsDir(), 'codex'),
  ])

  return found.flat().sort((a, b) => a.name.localeCompare(b.name))
}
