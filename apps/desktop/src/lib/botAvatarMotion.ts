import { BOT_AVATARS } from './botAvatars.ts'

import type { BotAvatarFile } from './botAvatars.ts'

const PERIOD_S = 6

// Grok Bot's idle loop: breathe in, glance left, blink, glance right, then a
// squash-and-stretch double hop with happy eyes. Every body frame stays inside
// the 256x256 canvas of the tallest character.
const KEYFRAMES = `@keyframes bot-body{
0%,40%,67%,100%{transform:none;animation-timing-function:ease-in-out}
22%{transform:scale(1.05);animation-timing-function:ease-in-out}
46%{transform:scale(1.09,.9);animation-timing-function:ease-out}
50%{transform:translateY(-4px) scale(.96,1.04);animation-timing-function:ease-out}
53%{transform:translateY(-14px);animation-timing-function:ease-in}
57%{transform:scale(1.08,.92);animation-timing-function:ease-out}
60%{transform:translateY(-7px) scale(.98,1.02);animation-timing-function:ease-in}
63.5%{transform:scale(1.03,.97);animation-timing-function:ease-in-out}
}
@keyframes bot-eye{
0%,14%,72%,100%{transform:none;animation-timing-function:ease-in-out}
20%,25%,28%{transform:translateX(-12px);animation-timing-function:ease-in-out}
26.5%{transform:translateX(-12px) scaleY(.1);animation-timing-function:ease-in-out}
33%,39%{transform:translateX(10px);animation-timing-function:ease-in-out}
43%,66%{transform:scale(1.2,.5);animation-timing-function:ease-in-out}
}`

/** Any character SVG with the idle loop, starting `delay` seconds in (negative = already playing). */
export function withIdleMotion(
  svg: string,
  delay: number,
  repeat: 'infinite' | '1' = 'infinite',
): string {
  const style =
    `<style>.bot-body,.bot-eye{transform-box:fill-box}` +
    `.bot-body{transform-origin:50% 100%;animation:bot-body ${String(PERIOD_S)}s ${String(delay)}s ${repeat}}` +
    `.bot-eye{transform-origin:50% 50%;animation:bot-eye ${String(PERIOD_S)}s ${String(delay)}s ${repeat}}` +
    `${KEYFRAMES}</style>`

  return svg.replace(/<svg\b[^>]*>/, (open) => open + style)
}

/**
 * The avatar SVG with its idle loop. `loop` repeats it, each character starting at its own
 * point so a sidebar of running agents never moves in lockstep. Otherwise it plays once
 * from the start.
 */
export function withBotAvatarMotion(svg: string, file: BotAvatarFile, loop = true): string {
  if (!loop) return withIdleMotion(svg, 0, '1')

  return withIdleMotion(
    svg,
    -Math.round(((BOT_AVATARS.indexOf(file) * 0.618034) % 1) * PERIOD_S * 100) / 100,
  )
}

/** How long one play of the loop lasts. */
export const BOT_AVATAR_LOOP_MS = PERIOD_S * 1000

/**
 * What a character image does. Reduce motion keeps it still; `looping` repeats the
 * idle loop; otherwise it is still until asked to play the loop once (hover, level-up).
 */
export function imageMotion({
  reduceMotion,
  looping,
}: {
  reduceMotion: boolean
  looping: boolean
}): 'still' | 'loop' | 'on-request' {
  if (reduceMotion) return 'still'

  return looping ? 'loop' : 'on-request'
}

const botAvatarSrc = (file: BotAvatarFile) => `/bot-avatars/${file}`
const sources = new Map<string, Promise<string | false>>()
const looping = new Map<string, string>()

/** The still SVG text at `src`, fetched once. False if it could not load. */
export function loadSvgText(src: string): Promise<string | false> {
  const pending =
    sources.get(src) ??
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`${src}: HTTP ${String(response.status)}`)

        return response.text()
      })
      .catch(() => {
        // A later hover or run may try again; until then the still file shows.
        sources.delete(src)

        return false
      })

  sources.set(src, pending)

  return pending
}

/** The still SVG text of a character, fetched once. False if it could not load. */
export function loadBotAvatarSvg(file: BotAvatarFile): Promise<string | false> {
  return loadSvgText(botAvatarSrc(file))
}

/** The looping copy of `src` if it is already built, so a remount never blinks still. */
export function readyLoopingSvgUrl(src: string): string | undefined {
  return looping.get(src)
}

/** The looping copy of `src`, built once and shared by every image that shows it. */
export async function loopingSvgUrl(
  src: string,
  animate: (svg: string) => string = (svg) => withIdleMotion(svg, 0),
): Promise<string | undefined> {
  const ready = looping.get(src)

  if (ready) return ready
  const svg = await loadSvgText(src)

  if (svg === false) return undefined
  const url = looping.get(src) ?? svgUrl(animate(svg))

  looping.set(src, url)

  return url
}

/** The looping copy if it is already built, so a remounted running avatar never blinks still. */
export function readyLoopingBotAvatarUrl(file: BotAvatarFile): string | undefined {
  return readyLoopingSvgUrl(botAvatarSrc(file))
}

/** The looping copy of a character, shared by every running agent that wears it. */
export function loopingBotAvatarUrl(file: BotAvatarFile): Promise<string | undefined> {
  return loopingSvgUrl(botAvatarSrc(file), (svg) => withBotAvatarMotion(svg, file))
}

/**
 * A fresh copy of `src` that plays the loop once from the start. Each image URL keeps one
 * animation clock, so a replay needs a new URL; revoke it once the play ends.
 */
export async function playOnceSvgUrl(src: string): Promise<string | undefined> {
  const svg = await loadSvgText(src)

  return svg === false ? undefined : svgUrl(withIdleMotion(svg, 0, '1'))
}

function svgUrl(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
}

export type PlayOnce = { play: () => void; dispose: () => void }

/**
 * Plays the loop once per `play()`: `build` makes a fresh URL, `onChange` gets it, and
 * after one loop, or on `dispose()`, gets undefined again and the URL is revoked. A play while one is
 * running is ignored, so pointer jitter never restarts it.
 */
export function createPlayOnce(
  build: () => Promise<string | undefined>,
  onChange: (url: string | undefined) => void,
  {
    durationMs = BOT_AVATAR_LOOP_MS,
    revoke = (url: string) => URL.revokeObjectURL(url),
    schedule = (done: () => void, ms: number) => {
      const timer = setTimeout(done, ms)

      return () => clearTimeout(timer)
    },
  } = {},
): PlayOnce {
  let busy = false
  let disposed = false
  let shown: string | undefined
  let cancel: (() => void) | undefined

  const finish = (url: string) => {
    revoke(url)
    shown = undefined
    busy = false
    cancel = undefined
    if (!disposed) onChange(undefined)
  }

  const start = (url: string | undefined) => {
    if (!url) {
      busy = false

      return
    }
    if (disposed) {
      revoke(url)

      return
    }
    shown = url
    onChange(url)
    cancel = schedule(() => finish(url), durationMs)
  }

  return {
    play() {
      if (busy || disposed) return
      busy = true
      void build().then(start)
    },
    dispose() {
      disposed = true
      cancel?.()
      if (!shown) return
      // Whoever showed the copy must drop it too: a revoked URL left in an <img> is a
      // broken image, and it comes back if the same character is shown again.
      revoke(shown)
      shown = undefined
      onChange(undefined)
    },
  }
}
