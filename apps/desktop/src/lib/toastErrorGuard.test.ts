import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// Error toasts are whitelist-only: caught failures must go through
// `toast.apiError(title, err)` so only backend-authored business errors reach
// the user. Rendering the raw error yourself — `parseAtlasError(err).message`,
// `err instanceof Error ? err.message : String(err)` — bypasses that gate and
// puts nginx 503 HTML / IPC noise on screen. The Lark connector landed hours
// after #496 and reintroduced exactly that, hence this guard.

const SRC = join(import.meta.dirname, '..')

const RAW_ERROR_PATTERNS = [/\bparseAtlasError\s*\(/, /\binstanceof\s+Error\b/]

// Whatever the file actually names its caught values — `catch (err)`,
// `catch (surprise)`, `.catch((cause) => …)` — so the guard doesn't depend on a
// list of blessed variable names.
function caughtNames(src: string): string[] {
  const names = [...src.matchAll(/\bcatch\s*\(\s*\(?([A-Za-z_$][\w$]*)/g)].map((m) => m[1])

  return [...new Set(names)]
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []

    return [path]
  })
}

// Text between the call's parentheses. Quote-aware so a ")" inside a message
// string doesn't close the call early.
function callArguments(src: string, openParen: number): string {
  let depth = 0
  let quote: string | null = null

  for (let i = openParen; i < src.length; i++) {
    const char = src[i]

    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return src.slice(openParen + 1, i)
  }

  return src.slice(openParen + 1)
}

// Matching a caught name anywhere in the arguments would flag "Log stream
// error" and "(e.g. instance)", so match the shapes that actually render one:
// `err.message`, `String(err)`, or the value passed through bare.
function usagePatterns(names: string[]): RegExp[] {
  if (names.length === 0) return []
  // `$` is legal in identifiers: unescaped it anchors the regex, and `\b` sees
  // no boundary in front of it either — both fail open, which is the one way a
  // guard must never fail. Escape, and delimit with explicit lookarounds.
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const name = `(?<![\\w$])(?:${escaped.join('|')})(?![\\w$])`

  return [
    new RegExp(`${name}\\s*\\.\\s*message\\b`),
    new RegExp(`\\bString\\s*\\(\\s*${name}\\s*\\)`),
    new RegExp(`(?:^|,)\\s*${name}\\s*,?\\s*$`),
  ]
}

function violations(path: string, src: string): string[] {
  const patterns = [...RAW_ERROR_PATTERNS, ...usagePatterns(caughtNames(src))]
  const found: string[] = []

  for (let i = src.indexOf('toast.error('); i !== -1; i = src.indexOf('toast.error(', i + 1)) {
    const args = callArguments(src, i + 'toast.error'.length)

    if (!patterns.some((pattern) => pattern.test(args))) continue
    const line = src.slice(0, i).split('\n').length

    found.push(`${path.slice(SRC.length + 1)}:${line}`)
  }

  return found
}

test('toast.error never renders a caught error — use toast.apiError', () => {
  const offenders = sourceFiles(SRC).flatMap((path) => violations(path, readFileSync(path, 'utf8')))

  assert.deepEqual(
    offenders,
    [],
    `These toast.error calls build their description from a caught error, bypassing the ` +
      `whitelist in toast.apiError:\n  ${offenders.join('\n  ')}\n` +
      `Pass the raw error to toast.apiError(title, err) instead (see apps/desktop/CLAUDE.md).`,
  )
})

test('the guard actually detects the shapes it claims to', () => {
  const samples = [
    "try { a(); } catch (err) { toast.error('Could not load', parseAtlasError(err).message); }",
    "try { a(); } catch (e) { toast.error('Could not load', e instanceof Error ? e.message : String(e)); }",
    "try { a(); } catch (cause) {\n  toast.error(\n    'Could not load',\n    cause.message\n  );\n}",
    // An unblessed name is caught too — the pattern comes from the file's own
    // catch clauses, not from a list of expected names.
    "try { a(); } catch (surprise) { toast.error('Could not load', surprise.message); }",
    "load().catch((whatever) => toast.error('Could not load', whatever.message));",
    "try { a(); } catch (err) { toast.error('Could not load', err); }",
    // `$` in an identifier must be escaped, not treated as an anchor.
    "try { a(); } catch ($err) { toast.error('Could not load', $err.message); }",
    "try { a(); } catch (e$) { toast.error('Could not load', String(e$)); }",
  ]

  for (const sample of samples) {
    assert.deepEqual(violations(join(SRC, 'sample.ts'), sample).length, 1, sample)
  }

  // Hand-authored descriptions stay legal in files that catch errors elsewhere —
  // these three shapes all tripped an earlier, looser version of the rule.
  const legal = [
    "try { a(); } catch (err) { report(err); }\ntoast.error('Could not copy :)', 'Copy it manually.');",
    // A title containing the word "error", next to a value that isn't caught.
    "try { a(); } catch (error) { report(error); }\ntoast.error('Log stream error', evt.message);",
    // "(e.g. instance)" is not a reference to `catch (e)`.
    "try { a(); } catch (e) { report(e); }\ntoast.error('No label filter', 'Pick a label (e.g. instance).');",
  ]

  for (const sample of legal) {
    assert.deepEqual(violations(join(SRC, 'sample.ts'), sample), [], sample)
  }
})
