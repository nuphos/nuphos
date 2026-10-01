#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Fails when a config enables a rule that cannot report: turned off downstream
// (eslint-config-prettier), deprecated to an inert stub, misspelled, or left
// with an empty visitor. Four such rules have shipped here already.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const CONFIG_NAMES = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs']
const LINTABLE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const TARGET_DIRS = ['.', 'apps/backend', 'apps/desktop', 'apps/admin']
/** Config resolution is per-file; sampling a few files per block keeps it so. */
const SAMPLE_PER_BLOCK = 8

export function severityOf(entry) {
  const value = Array.isArray(entry) ? entry[0] : entry

  if (value === 'off' || value === 0) return 0
  if (value === 'warn' || value === 1) return 1
  if (value === 'error' || value === 2) return 2

  return null
}

// Preset blocks carry a `name` (`defineConfig` stamps every `extends` entry
// and shared config); unnamed blocks are what this repo wrote, the only thing
// worth auditing.
export function handWrittenBlocks(configArray) {
  return configArray.filter(
    (block) => block?.name === undefined && block?.rules && Object.keys(block.rules).length > 0,
  )
}

export function collectRuleImplementations(configArray, builtinRules) {
  const impls = new Map(builtinRules)

  for (const block of configArray) {
    for (const [pluginName, plugin] of Object.entries(block?.plugins ?? {})) {
      for (const [ruleName, rule] of Object.entries(plugin?.rules ?? {})) {
        impls.set(`${pluginName}/${ruleName}`, rule)
      }
    }
  }

  return impls
}

// Probes through a real `Linter` so ESLint applies the schema defaults the
// rule's `create` may destructure. A throw is inconclusive, not dead —
// type-aware rules need a program this probe cannot give them.
export function visitorKeys(rule, entry, Linter) {
  let keys = null
  const probe = {
    ...rule,
    create(context) {
      const visitor = rule.create(context)

      keys = Object.keys(visitor ?? {})

      return visitor ?? {}
    },
  }

  try {
    new Linter().verify('const probe = [];\nprobe.push(1);\nprobe.push(2);\n', {
      plugins: { probe: { rules: { target: probe } } },
      rules: { 'probe/target': entry },
    })
  } catch {
    return null
  }

  return keys
}

export function auditRule({ ruleId, entry, rule, liveSeverity, Linter }) {
  if (!rule)
    return { ruleId, kind: 'unknown', detail: 'no implementation is registered under this name' }

  const declared = severityOf(entry)

  if (declared === 0) return null

  if (liveSeverity === 0) {
    return {
      ruleId,
      kind: 'off',
      detail:
        'declared here but resolves to severity 0 — something later in the config turns it off',
    }
  }

  const deprecation = rule.meta?.deprecated

  if (deprecation) {
    const replacement = rule.meta?.replacedBy ?? deprecation?.replacedBy
    const names = (Array.isArray(replacement) ? replacement : [])
      .map((item) => item?.rule?.name ?? item)
      .filter((name) => typeof name === 'string')

    return {
      ruleId,
      kind: 'deprecated',
      detail: names.length ? `deprecated; use ${names.join(', ')}` : 'deprecated by its plugin',
    }
  }

  const keys = visitorKeys(rule, entry, Linter)

  if (keys && keys.length === 0) {
    return {
      ruleId,
      kind: 'no-visitor',
      detail: 'create() returns an empty visitor, so it can never report',
    }
  }

  return null
}

function trackedFiles(absDir) {
  const stdout = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--other', '--exclude-standard'],
    {
      cwd: absDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )

  return stdout.split('\0').filter((file) => file && LINTABLE.has(path.extname(file)))
}

function matchesBlock(file, files) {
  if (!files) return true

  return files.some((pattern) =>
    Array.isArray(pattern)
      ? pattern.every((one) => path.matchesGlob(file, one))
      : path.matchesGlob(file, pattern),
  )
}

/** Evenly spaced rather than the first N: a block's first matches cluster in one directory. */
function spread(items, limit) {
  if (items.length <= limit) return items
  const step = items.length / limit

  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * step)])
}

async function resolveTarget(absDir) {
  const require_ = createRequire(path.join(absDir, 'package.json'))
  const eslintModule = await import(pathToFileURL(require_.resolve('eslint')))
  const internals = await import(pathToFileURL(require_.resolve('eslint/use-at-your-own-risk')))

  const configName = CONFIG_NAMES.find((name) => {
    try {
      return require_.resolve(path.join(absDir, name))
    } catch {
      return false
    }
  })

  if (!configName) throw new Error(`no flat ESLint config found in ${absDir}`)

  const configArray = (await import(pathToFileURL(path.join(absDir, configName)))).default

  return { eslintModule, builtinRules: internals.builtinRules, configArray, configName }
}

// A rule counts as live when any sampled file the block matches resolves it at
// a real severity. One file is not enough: a later block may legitimately
// switch a rule off for tests.
async function sampleBlock(eslint, absDir, files, block, resolvedCache) {
  const matched = files.filter((file) => matchesBlock(file, block.files))
  const sample = []

  for (const file of spread(matched, SAMPLE_PER_BLOCK * 3)) {
    if (sample.length >= SAMPLE_PER_BLOCK) break
    const abs = path.join(absDir, file)

    if (await eslint.isPathIgnored(abs)) continue
    sample.push(abs)
    if (!resolvedCache.has(abs)) resolvedCache.set(abs, await eslint.calculateConfigForFile(abs))
  }

  return sample
}

function liveSeverityOf(ruleId, sample, resolvedCache) {
  if (sample.length === 0) return 1
  const seen = sample.map((abs) => severityOf(resolvedCache.get(abs).rules?.[ruleId] ?? 0))

  return seen.some((severity) => severity > 0) ? 1 : 0
}

export async function auditTarget(relDir) {
  const absDir = path.join(REPO_ROOT, relDir)
  const { eslintModule, builtinRules, configArray, configName } = await resolveTarget(absDir)
  const { ESLint, Linter } = eslintModule

  const eslint = new ESLint({ cwd: absDir })
  const impls = collectRuleImplementations(configArray, builtinRules)
  const blocks = handWrittenBlocks(configArray)
  const files = trackedFiles(absDir)

  const resolvedCache = new Map()
  const samples = new Map()

  for (const block of blocks) {
    samples.set(block, await sampleBlock(eslint, absDir, files, block, resolvedCache))
  }

  const findings = []
  const checked = new Set()

  for (const block of blocks) {
    const where = block.files ? block.files.flat().join(', ') : '(all files)'

    for (const [ruleId, entry] of Object.entries(block.rules)) {
      checked.add(ruleId)
      const finding = auditRule({
        ruleId,
        entry,
        rule: impls.get(ruleId),
        liveSeverity: liveSeverityOf(ruleId, samples.get(block), resolvedCache),
        Linter,
      })

      if (finding) findings.push({ ...finding, block: where })
    }
  }

  return {
    target: relDir,
    configName,
    ruleCount: checked.size,
    blockCount: blocks.length,
    findings,
  }
}

async function main() {
  const only = process.argv.slice(2)
  const targets = only.length > 0 ? only : TARGET_DIRS
  let failed = false

  for (const target of targets) {
    let report

    try {
      report = await auditTarget(target)
    } catch (error) {
      // A config ESLint itself refuses to load is the same failure in a louder
      // form — an unknown rule name reads as enforced too.
      failed = true
      console.error(`FAIL ${target}: the config could not be resolved\n  ${error.message}`)
      continue
    }
    const label = `${report.target}/${report.configName}`

    if (report.findings.length === 0) {
      console.log(
        `ok  ${label}: ${report.ruleCount} hand-written rules across ${report.blockCount} blocks`,
      )
      continue
    }
    failed = true
    console.error(`FAIL ${label}: ${report.findings.length} rule(s) cannot report`)
    for (const finding of report.findings) {
      console.error(`  ${finding.ruleId} [${finding.kind}] — ${finding.detail}`)
      console.error(`    declared for: ${finding.block}`)
    }
  }

  if (failed) {
    console.error('\nA rule that cannot report is worse than a missing rule: it reads as enforced.')
    process.exit(1)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
