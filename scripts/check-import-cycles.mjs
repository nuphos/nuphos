#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// madge depends on typescript, so it is always present alongside it.
import ts from 'typescript'

// madge counts `import type` edges that TypeScript erases, so `skipTypeImports`
// is required for the tally to reflect real cycles. The baseline is a ratchet:
// known cycles are recorded, new ones fail.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE = path.join(import.meta.dirname, 'import-cycles.baseline.json')

const TARGETS = [
  {
    name: 'backend',
    roots: ['apps/backend/src'],
    extensions: ['ts'],
    tsConfig: 'apps/backend/tsconfig.json',
  },
  {
    name: 'desktop',
    roots: ['apps/desktop/src', 'apps/desktop/electron'],
    extensions: ['ts', 'tsx'],
    tsConfig: 'apps/desktop/tsconfig.app.json',
  },
  {
    name: 'admin',
    roots: ['apps/admin/app', 'apps/admin/components', 'apps/admin/hooks', 'apps/admin/lib'],
    extensions: ['ts', 'tsx'],
    // `paths` without `baseUrl`: filing-cabinet's path mapping needs both, and
    // silently drops every `@/…` edge when the base is missing.
    tsConfig: { file: 'apps/admin/tsconfig.json', baseUrl: 'apps/admin' },
  },
]

/** Same cycle, same string: rotate to the smallest member, then compare. */
export function canonicalCycle(cycle) {
  let best = 0

  for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[best]) best = i

  return [...cycle.slice(best), ...cycle.slice(0, best)]
}

export function canonicalCycles(cycles) {
  return cycles.map((cycle) => canonicalCycle(cycle).join(' -> ')).sort()
}

export function compareToBaseline(found, recorded) {
  const before = new Set(recorded)
  const now = new Set(found)

  return {
    added: found.filter((cycle) => !before.has(cycle)),
    removed: recorded.filter((cycle) => !now.has(cycle)),
  }
}

/** tsconfig is JSONC (comments, trailing commas), so plain JSON.parse chokes on it. */
export function parseTsConfig(file, text) {
  const { config, error } = ts.parseConfigFileTextToJson(file, text)

  if (error) throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)

  return config
}

function tsConfigFor(target) {
  if (typeof target.tsConfig === 'string') return path.join(REPO_ROOT, target.tsConfig)
  const file = path.join(REPO_ROOT, target.tsConfig.file)
  const raw = parseTsConfig(file, readFileSync(file, 'utf8'))

  return {
    ...raw,
    compilerOptions: {
      ...raw.compilerOptions,
      baseUrl: path.join(REPO_ROOT, target.tsConfig.baseUrl),
    },
  }
}

async function analyze(name) {
  const target = TARGETS.find((entry) => entry.name === name)

  if (!target) throw new Error(`unknown target ${name}`)

  const { default: madge } = await import('madge')
  const result = await madge(
    target.roots.map((root) => path.join(REPO_ROOT, root)),
    {
      fileExtensions: target.extensions,
      tsConfig: tsConfigFor(target),
      // Both keys are needed: precinct dispatches `.tsx` under its own type and
      // reads the options bucket that matches, so a `ts`-only entry leaves
      // every `.tsx` file counting the type imports this exists to drop.
      detectiveOptions: {
        ts: { skipTypeImports: true },
        tsx: { skipTypeImports: true },
      },
    },
  )

  return canonicalCycles(result.circular())
}

/** One child per target: madge's resolver caches leak between same-process analyses and quietly change the graph. */
function analyzeInChild(name) {
  const stdout = execFileSync(process.execPath, [import.meta.filename, '--analyze', name], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  return JSON.parse(stdout)
}

function report(name, { added, removed }) {
  for (const cycle of added) console.error(`  NEW    ${name}: ${cycle}`)
  for (const cycle of removed) console.error(`  GONE   ${name}: ${cycle}`)
}

async function main() {
  const args = process.argv.slice(2)

  const analyzeIndex = args.indexOf('--analyze')

  if (analyzeIndex !== -1) {
    process.stdout.write(JSON.stringify(await analyze(args[analyzeIndex + 1])))

    return
  }

  const update = args.includes('--update')
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const found = {}

  for (const target of TARGETS) found[target.name] = analyzeInChild(target.name)

  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`)
    for (const target of TARGETS) console.log(`${target.name}: ${found[target.name].length} cycles`)
    console.log(`baseline updated: ${path.relative(REPO_ROOT, BASELINE)}`)

    return
  }

  let drifted = false

  for (const target of TARGETS) {
    const diff = compareToBaseline(found[target.name], baseline[target.name] ?? [])

    if (diff.added.length === 0 && diff.removed.length === 0) {
      console.log(`ok  ${target.name}: ${found[target.name].length} cycles, all known`)
      continue
    }
    drifted = true
    console.error(`FAIL ${target.name}: ${diff.added.length} new, ${diff.removed.length} resolved`)
    report(target.name, diff)
  }

  if (drifted) {
    console.error(
      '\nA NEW cycle means two modules now depend on each other — break it rather than record it.' +
        '\nA GONE cycle means the baseline is stale: run `bun run check:cycles -- --update`.',
    )
    process.exit(1)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
