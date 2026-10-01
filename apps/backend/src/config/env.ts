// The primitive env readers every config section is built from. These, and the
// section modules beside them, are the only production files allowed to touch
// `process.env` — see the repo-root CLAUDE.md and config.env-sync.test.ts.

export function required(key: string): string {
  const val = process.env[key]

  if (!val) throw new Error(`${key} environment variable is required`)

  return val
}

export function optional(key: string): string | undefined {
  const v = process.env[key]

  return v && v.length > 0 ? v : undefined
}

export function optionalList(key: string): string[] {
  return (process.env[key] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function boundedInt(
  key: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = process.env[key]

  if (!raw) return fallback
  const normalized = raw.trim()

  if (!/^-?\d+$/.test(normalized)) {
    throw new TypeError(`${key} must be an integer (got: ${JSON.stringify(raw)})`)
  }
  const value = Number(normalized)

  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${key} must be an integer (got: ${JSON.stringify(raw)})`)
  }
  if (value < min || value > max) {
    throw new Error(
      `${key} must be between ${String(min)} and ${String(max)} (got: ${String(value)})`,
    )
  }

  return value
}

export function boundedFloat(
  key: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = process.env[key]

  if (!raw) return fallback
  // Number() is strict: "0.2oops" → NaN, unlike Number.parseFloat which would
  // silently accept the leading "0.2". We want misconfigured env vars to fail
  // loudly at startup rather than half-parse to a surprising value.
  const value = Number(raw.trim())

  if (!Number.isFinite(value)) {
    throw new TypeError(`${key} must be a number (got: ${JSON.stringify(raw)})`)
  }
  if (value < min || value > max) {
    throw new Error(
      `${key} must be between ${String(min)} and ${String(max)} (got: ${String(value)})`,
    )
  }

  return value
}

export function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key]

  if (v == null || v === '') return fallback

  return /^(1|true|yes|on)$/i.test(v)
}
