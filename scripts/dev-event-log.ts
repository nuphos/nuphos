// The dashboard's event stream, plus the flag that says a repaint is owed.
// Anything that changes what the screen should show marks it dirty; the render
// loop is the only reader.

export type EventSource = { name: string; color: string }
export type Event = { at: string; svc: EventSource; msg: string }
export const events: Event[] = []
const MAX_EVENTS = 200

export const TTY = Boolean(process.stdout.isTTY)

let dirty = true

export function markDirty() {
  dirty = true
}

/** True at most once per pending repaint. */
export function consumeDirty(): boolean {
  if (!dirty) return false
  dirty = false

  return true
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function clock(): string {
  const d = new Date()

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// A milestone worth showing on the dashboard. Raw log lines never come here —
// they go to the per-service log file. This is what keeps the UI Next.js-clean.
export function pushEvent(svc: EventSource, msg: string) {
  const ev: Event = { at: clock(), svc, msg }

  events.push(ev)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  markDirty()
  // In a non-TTY (piped/redirected) we can't repaint an alt screen, so append
  // the event as a normal line — still clean, no raw JSON.
  if (!TTY) process.stdout.write(`${svc.color}${svc.name}\x1b[0m  ${msg}\n`)
}
