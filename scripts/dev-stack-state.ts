// Pure helpers behind the mongo / rustfs / runtime rows.

/** Layers seen and finished in `docker pull`'s plain (non-TTY) output. */
export type PullProgress = { layers: ReadonlyMap<string, boolean> }

export const NO_PULL: PullProgress = { layers: new Map() }

const LAYER_LINE = /^([0-9a-f]{12}): (.+)$/
const LAYER_DONE = /^(Pull complete|Already exists)/

export function pullLine(progress: PullProgress, line: string): PullProgress {
  const match = LAYER_LINE.exec(line.trim())

  if (!match) return progress
  const [, layer, status] = match
  const done = progress.layers.get(layer!) === true || LAYER_DONE.test(status!)
  const layers = new Map(progress.layers)

  layers.set(layer!, done)

  return { layers }
}

export function pullLabel(progress: PullProgress): string {
  const total = progress.layers.size
  const done = [...progress.layers.values()].filter(Boolean).length

  return total ? `pulling image, ${String(done)}/${String(total)} layers` : 'pulling image …'
}

/** Service name → image (and platform) from `docker compose config --format json`. */
export function composeImages(json: string): Record<string, { image: string; platform?: string }> {
  const parsed = JSON.parse(json) as {
    services?: Record<string, { image?: string; platform?: string }>
  }
  const out: Record<string, { image: string; platform?: string }> = {}

  for (const [name, service] of Object.entries(parsed.services ?? {})) {
    if (service.image)
      out[name] = {
        image: service.image,
        ...(service.platform ? { platform: service.platform } : {}),
      }
  }

  return out
}

/** The last few meaningful lines of a failed command, for the dashboard. */
export function errorTail(lines: readonly string[], count = 2): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(' · ')
    .slice(0, 240)
}

/** One run at a time: a caller arriving mid-run waits for that run instead of starting another. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    inFlight ??= run().finally(() => {
      inFlight = null
    })

    return inFlight
  }
}
