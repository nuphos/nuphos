import yaml from 'yaml'

import { byCodeUnit } from '@/lib/agent/sort-order'

export type DiscoveredSkill = {
  /** Frontmatter name, or the folder name when SKILL.md has none. */
  name: string
  description: string | null
  /** Folder of the skill inside the repository; empty for a root skill. */
  path: string
  /** Files keyed by path relative to the skill folder. */
  files: Map<string, Uint8Array>
  /** Set when SKILL.md lacks the frontmatter `skills add` requires. */
  malformed: boolean
}

// Search order and depths follow vercel-labs/skills `discoverSkills`.
const CONTAINERS = [
  'skills',
  'skills/.curated',
  'skills/.experimental',
  'skills/.system',
  '.claude/skills',
  '.agents/skills',
  '.codex/skills',
  '.github/skills',
]
const CONTAINER_DEPTH = 3
const FALLBACK_DEPTH = 5
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

function childDirs(files: Iterable<string>): Map<string, Set<string>> {
  const children = new Map<string, Set<string>>()

  for (const file of files) {
    const parts = file.split('/')

    parts.slice(0, -1).forEach((part, i) => {
      const parent = parts.slice(0, i).join('/')

      children.set(parent, (children.get(parent) ?? new Set()).add(part))
    })
  }

  return children
}

function frontmatter(markdown: string): { name?: unknown; description?: unknown } {
  const raw = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1]

  try {
    const parsed: unknown = raw ? yaml.parse(raw) : null

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Gives every found skill folder its files in one pass over the archive. */
function filesByFolder(files: Map<string, Uint8Array>, folders: Set<string>) {
  const byFolder = new Map([...folders].map((dir) => [dir, new Map<string, Uint8Array>()]))

  for (const [file, data] of files) {
    const parts = file.split('/')

    parts.forEach((_, i) =>
      byFolder.get(parts.slice(0, i).join('/'))?.set(parts.slice(i).join('/'), data),
    )
  }

  return byFolder
}

function readSkill(path: string, own: Map<string, Uint8Array>): DiscoveredSkill {
  const meta = frontmatter(new TextDecoder().decode(own.get('SKILL.md')))
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''

  return {
    name: name || (path.split('/').at(-1) ?? ''),
    description: description || null,
    path,
    files: own,
    malformed: !name || !description,
  }
}

/** Finds skill folders the way `npx skills add` does, first match per name winning. */
export function discoverSkills(
  files: Map<string, Uint8Array>,
  subpath: string | null,
): DiscoveredSkill[] {
  const base = subpath ?? ''
  const isSkill = (dir: string) => files.has(join(dir, 'SKILL.md'))

  const children = childDirs(files.keys())
  const found = new Set<string>()
  const walk = (dir: string, depth: number) => {
    for (const name of [...(children.get(dir) ?? [])].sort(byCodeUnit)) {
      const child = join(dir, name)

      if (SKIP_DIRS.has(name) || found.has(child)) continue
      if (isSkill(child)) found.add(child)
      else if (depth > 1) walk(child, depth - 1)
    }
  }

  if (isSkill(base)) found.add(base)
  else {
    walk(base, 1)
    for (const container of CONTAINERS) walk(join(base, container), CONTAINER_DEPTH)
    if (found.size === 0) walk(base, FALLBACK_DEPTH)
  }
  const seen = new Set<string>()

  return [...filesByFolder(files, found)]
    .map(([dir, own]) => readSkill(dir, own))
    .filter((skill) => {
      const fresh = !seen.has(skill.name)

      seen.add(skill.name)

      return fresh
    })
}
