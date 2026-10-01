// ─── TUI render ───────────────────────────────────────────────────────────────
// One full repaint of the alt screen per dirty tick: service rows, the tunnel
// row, then as much of the event stream as fits.
import { join } from 'node:path'

import { events, TTY } from './dev-event-log.ts'
import { DEV_OPTIONS } from './dev-options.ts'
import { QUIT_OPTIONS, quitMenuView } from './dev-quit.ts'
import { services } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import { tunnel } from './dev-tunnel.ts'
import { LOG_DIR, WT_ID } from './dev-workspace.ts'

import type { Service, Status } from './dev-services.ts'

const DOT: Record<Status, string> = {
  starting: '\x1b[33m◐\x1b[0m',
  ready: '\x1b[32m●\x1b[0m',
  degraded: '\x1b[33m▲\x1b[0m',
  crashed: '\x1b[31m✕\x1b[0m',
  stopped: '\x1b[90m○\x1b[0m',
}

export const DIM = '\x1b[2m'
export const RESET = '\x1b[0m'
export const BOLD = '\x1b[1m'
export const GREEN = '\x1b[32m'

// Terminal size, defended against the two footguns that crashed the old build:
// `columns`/`rows` can be `undefined` (non-TTY) *or* `0` (some PTYs/multiplexers).
// `??` only guards undefined, so a reported 0 slipped through into repeat(<0>).
function termCols(): number {
  return Math.max(24, process.stdout.columns || 100)
}
function termRows(): number {
  return Math.max(10, process.stdout.rows || 30)
}
function rule(cols: number): string {
  return `${DIM}${'─'.repeat(Math.max(4, Math.min(cols - 4, 72)))}${RESET}`
}

const TUNNEL_DOT: Record<string, string> = {
  ready: DOT.ready,
  starting: DOT.starting,
  missing: DOT.crashed,
  error: DOT.crashed,
}

function tunnelRow(): string {
  const dot = TUNNEL_DOT[tunnel.status] ?? DOT.stopped
  const body = tunnel.url ?? `${DIM}${tunnel.note || 'off'}${RESET}`
  const kind = tunnel.url && tunnel.kind ? ` ${DIM}(${tunnel.kind})${RESET}` : ''

  return `  ${dot} ${BOLD}${'tunnel'.padEnd(9)}${RESET} ${body}${kind}`
}

function quitMenuRows(): string[] {
  const menu = quitMenuView.menu

  if (!menu) return []
  const rows = QUIT_OPTIONS.map(({ label }, i) =>
    i === menu.index ? `  ${BOLD}❯ ${label}${RESET}` : `    ${DIM}${label}${RESET}`,
  )
  const hint = menu.confirming
    ? '\x1b[31mDeletes the local database, buckets and managed agents. Enter or y to confirm, Esc to go back.\x1b[0m'
    : `${DIM}↑/↓ move · Enter choose · Esc or q cancel${RESET}`

  return ['', `  ${BOLD}Quit nuphos dev${RESET}`, ...rows, `  ${hint}`]
}

function serviceRow(s: Service): string[] {
  const label = s.name.padEnd(9)
  const url = s.url ?? s.note ?? (s.status === 'crashed' ? '—' : 'starting…')
  const ready = s.readyMs != null ? `${DIM}(${(s.readyMs / 1000).toFixed(1)}s)${RESET}` : ''
  const health = Object.entries(s.health)
    .map(([k, v]) => `${k} ${v}`)
    .join('   ')
  const stalled = s.status === 'starting' && s.stallNoticed > 0 && s.startedAt != null
  const warn = stalled
    ? ` \x1b[33m⚠ stuck ${Math.round((Date.now() - s.startedAt!) / 1000)}s${RESET}`
    : ''
  const rows = [`  ${DOT[s.status]} ${BOLD}${label}${RESET} ${url} ${ready}${warn}`]

  if (health) rows.push(`    ${DIM}${health}${RESET}`)
  if (stalled && s.lastRaw) rows.push(`    ${DIM}last: ${s.lastRaw.slice(0, 90)}${RESET}`)

  return rows
}

export function render() {
  if (!TTY || isQuitting()) return // non-TTY streams events as plain lines; nothing to repaint
  if (quitMenuView.menu) {
    process.stdout.write(`\x1b[H\x1b[2J${quitMenuRows().join('\r\n')}`)

    return
  }
  const rows = termRows()
  const cols = termCols()
  const out: string[] = []
  const mode = `${DEV_OPTIONS.mode === 'admin' ? ' --admin' : ''}${DEV_OPTIONS.managed ? ' --managed' : ''}`

  out.push(
    '',
    `  ${BOLD}▲ nuphos dev${mode}${RESET}   ${DIM}${WT_ID}  ·  r restart   q quit${RESET}`,
    `  ${rule(cols)}`,
  )
  for (const s of services) out.push(...serviceRow(s))
  out.push(tunnelRow(), '', `  ${DIM}events${RESET}`, `  ${rule(cols)}`)
  const headerLines = out.length
  const footerLines = 2
  const eventRows = Math.max(3, rows - headerLines - footerLines - 1)

  for (const ev of events.slice(-eventRows)) {
    out.push(`  ${DIM}${ev.at}${RESET} ${ev.svc.color}${ev.svc.name.padEnd(8)}${RESET} ${ev.msg}`)
  }
  out.push('')
  const rawLogGlob = join(LOG_DIR, `${WT_ID}-${String(process.pid)}-*.log`)

  out.push(`  ${DIM}raw logs → ${rawLogGlob}${RESET}`)
  process.stdout.write(`\x1b[H\x1b[2J${out.join('\r\n')}`)
}

export function enterAltScreen() {
  if (TTY) process.stdout.write('\x1b[?1049h\x1b[?25l')
}
export function leaveAltScreen() {
  if (TTY) process.stdout.write('\x1b[?25h\x1b[?1049l')
}
