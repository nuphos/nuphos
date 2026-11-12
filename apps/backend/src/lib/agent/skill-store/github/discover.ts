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

function readSkill(files: Map<string, Uint8Array>, path: string): DiscoveredSkill {
  const prefix = path ? `${path}/` : ''
  const own = new Map<string, Uint8Array>()

  for (const [file, data] of files)
    if (file.startsWith(prefix)) own.set(file.slice(prefix.length), data)
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

  if (isSkill(base)) return [readSkill(files, base)]
  const children = childDirs(files.keys())
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    for (const name of [...(children.get(dir) ?? [])].sort(byCodeUnit)) {
      const child = join(dir, name)

      if (SKIP_DIRS.has(name) || found.includes(child)) continue
      if (isSkill(child)) found.push(child)
      else if (depth > 1) walk(child, depth - 1)
    }
  }

  walk(base, 1)
  for (const container of CONTAINERS) walk(join(base, container), CONTAINER_DEPTH)
  if (found.length === 0) walk(base, FALLBACK_DEPTH)
  const seen = new Set<string>()

  return found
    .map((dir) => readSkill(files, dir))
    .filter((skill) => {
      const fresh = !seen.has(skill.name)

      seen.add(skill.name)

      return fresh
    })
}
