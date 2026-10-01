// Reading a child process's stdout/stderr: chunks in, whole lines out, with the
// colour escapes the log parsers must not trip over.

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, 'g')

export const ANSI_COLOR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

const CONCRETE_CRASH =
  /(err_pnpm_|command not found|cannot find module|err_module_not_found|syntaxerror|referenceerror|typeerror|enoent|eaddrinuse)/i
const GENERIC_CRASH = /(^|\b)(error|failed|fatal)(:|\b)/i

function diagnosticScore(line: string): number {
  if (CONCRETE_CRASH.test(line)) return 100
  if (GENERIC_CRASH.test(line)) return 60
  if (/elifecycle/i.test(line)) return 20

  return 1
}

function isDiagnosticNoise(line: string): boolean {
  return (
    /DeprecationWarning:/.test(line) ||
    /^\(Use .+--trace-deprecation .+\)$/.test(line) ||
    /^>\s/.test(line) ||
    /^\[nuphos-dev\]\s/.test(line) ||
    /^\s*local:\s+https?:\/\//i.test(line) ||
    /vite\s+v?[\d.]+\s+ready/i.test(line) ||
    /press h \+ enter to show help/i.test(line)
  )
}

/** Pick the most useful recent child-output line for a compact crash event. */
export function selectCrashDiagnostic(lines: string[]): string | null {
  let best: string | null = null
  let bestScore = 0

  for (const raw of lines) {
    const line = stripAnsi(raw).trim().replace(/\s+/g, ' ')

    if (!line || isDiagnosticNoise(line)) continue
    const score = diagnosticScore(line)

    // Prefer the newest line when two candidates carry the same signal.
    if (score >= bestScore) {
      best = line
      bestScore = score
    }
  }

  return best?.slice(0, 200) ?? null
}

export function pipeLines(stream: NodeJS.ReadableStream | null, onLine: (l: string) => void) {
  if (!stream) return
  let buf = ''

  stream.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let idx: number

    while ((idx = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, idx))
      buf = buf.slice(idx + 1)
    }
  })
  stream.on('end', () => {
    if (buf.trim()) onLine(buf)
  })
}
