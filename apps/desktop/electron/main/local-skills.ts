// Skills this computer already has: the directories Claude Code and Codex read
// from. Listing them and walking one is all this module owns; reading and
// uploading a skill's files is local-skill-import.ts.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Dirent, Stats } from 'node:fs'

export type LocalSkillSource = 'claude' | 'codex'

export type LocalSkillInfo = {
  /** `<source>/<name>` — a name can exist under both agents. */
  id: string
  name: string
  source: LocalSkillSource
  path: string
  /** First line of the SKILL.md frontmatter `description`, when it has one. */
  description: string | null
  fileCount: number
  totalBytes: number
  updatedAt: string
}

export type LocalSkillEntry = {
  relPath: string
  /** The file itself, after links: read this, never `relPath` under the skill. */
  realPath: string
  size: number
  mtimeMs: number
}

/** The team skill store rejects anything larger, so skip it before uploading. */
export const MAX_SKILL_FILE_BYTES = 10_000_000
const MAX_FILES = 200
const MAX_DEPTH = 6
const SKIP_ENTRIES = new Set(['.git', '.DS_Store', 'node_modules'])

function skillRoots(): { source: LocalSkillSource; dir: string }[] {
  const home = os.homedir()

  return [
    { source: 'claude', dir: path.join(home, '.claude', 'skills') },
    { source: 'codex', dir: path.join(home, '.agents', 'skills') },
  ]
}

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

/**
 * Read-only and world-readable by construction, so a link into it cannot expose
 * anything private. Nix home-manager installs skills as links into it.
 */
const READ_ONLY_ROOTS = ['/nix/store']

function isUnder(target: string, base: string): boolean {
  return target.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`)
}

type Resolved = { real: string; stat: Stats }

/**
 * Where an entry really is and what it is. A link is followed only to a place
 * in `allowed` — its own skill, the skills directory (gstack links each skill
 * into one shared checkout there) or a read-only root — never elsewhere.
 */
async function resolveEntry(
  entry: Dirent,
  full: string,
  allowed: readonly string[],
): Promise<Resolved | null> {
  try {
    if (!entry.isSymbolicLink()) return { real: full, stat: await fs.lstat(full) }
    const real = await fs.realpath(full)

    if (!allowed.some((base) => isUnder(real, base))) return null

    return { real, stat: await fs.stat(real) }
  } catch {
    // Vanished between readdir and stat, or a dangling link: treat it as absent.
    return null
  }
}

/**
 * Every regular file under a skill directory, flattened to relative paths. The
 * skill directory may itself be a link; links inside it are followed only as
 * resolveEntry allows, a link back to a directory being walked is skipped, and
 * depth and file count are capped, so a link cannot pull in the rest of the
 * computer or loop.
 */
export async function localSkillEntries(
  root: string,
  readOnlyRoots: readonly string[] = READ_ONLY_ROOTS,
): Promise<LocalSkillEntry[]> {
  const out: LocalSkillEntry[] = []
  const realRoot = await fs.realpath(root).catch(() => null)
  const skillsDir = await fs.realpath(path.dirname(root)).catch(() => null)

  if (!realRoot) return out
  const allowed = [realRoot, ...(skillsDir ? [skillsDir] : []), ...readOnlyRoots]

  // `ancestors`, not every directory seen: an alias such as `assets -> scripts`
  // must not hide the real `scripts/` path.
  async function walk(dir: string, prefix: string, depth: number, ancestors: Set<string>) {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES || ancestors.has(dir)) return
    const lineage = new Set(ancestors).add(dir)
    let entries: Dirent[]

    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return
      if (SKIP_ENTRIES.has(entry.name)) continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      const resolved = await resolveEntry(entry, path.join(dir, entry.name), allowed)

      if (resolved?.stat.isDirectory()) await walk(resolved.real, relPath, depth + 1, lineage)
      else if (resolved?.stat.isFile()) {
        const { real, stat } = resolved

        out.push({ relPath, realPath: real, size: stat.size, mtimeMs: stat.mtimeMs })
      }
    }
  }

  await walk(realRoot, '', 0, new Set())

  // SKILL.md first: it is the file the store keys the skill on, so a partial
  // upload still leaves a listable skill rather than orphan objects.
  return out.sort((a, b) => {
    if (a.relPath === 'SKILL.md') return -1
    if (b.relPath === 'SKILL.md') return 1

    return a.relPath.localeCompare(b.relPath)
  })
}

async function describeSkill(
  source: LocalSkillSource,
  dir: string,
  name: string,
): Promise<LocalSkillInfo | null> {
  const root = path.join(dir, name)
  const markdown = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8').catch(() => null)

  // Without a SKILL.md the directory is not a skill — the store keys on it too.
  if (markdown === null) return null
  const entries = await localSkillEntries(root)

  return {
    id: `${source}/${name}`,
    name,
    source,
    path: root,
    description: skillDescription(markdown),
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    updatedAt: new Date(Math.max(0, ...entries.map((entry) => entry.mtimeMs))).toISOString(),
  }
}

export async function listLocalSkills(): Promise<LocalSkillInfo[]> {
  const found = await Promise.all(
    skillRoots().map(async ({ source, dir }) => {
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
    }),
  )

  return found.flat().sort((a, b) => a.name.localeCompare(b.name))
}
