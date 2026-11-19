// OpenCode (1.19) retries a provider's refusal inside the open prompt and sends nothing
// over ACP, so a turn OpenCode Zen refuses ("Free usage limit reached") never ends. Its
// own log is the only place the refusal shows.
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enough of the log for the lines one turn writes.
const TAIL_BYTES = 64 * 1024

function tail(file) {
  const fd = openSync(file, 'r')
  try {
    const { size } = statSync(file)
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Why OpenCode cannot answer this session's turn, when it logged since `since` that the
 * provider refused it for good: a usage limit, which retrying does not get past.
 * Undefined while the turn may still be answered.
 */
export function openCodeRefusal(dataHome, sessionId, since) {
  const dir = join(dataHome, 'opencode', 'log')
  let newest
  try {
    newest = readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => ({ file: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0]?.file
  } catch {
    return undefined
  }
  if (!newest) return undefined
  for (const line of tail(newest).split('\n').reverse()) {
    // The turn's own request, not its title's (small=true).
    if (
      !line.includes('message="stream error"') ||
      !line.includes(` session.id=${sessionId} `) ||
      !line.includes(' small=false ')
    )
      continue
    if (!(Date.parse(/^timestamp=(\S+)/u.exec(line)?.[1] ?? '') >= since)) return undefined
    const error = /error\.error="((?:[^"\\]|\\.)*)"/u.exec(line)?.[1]
    if (error && /usage limit/iu.test(error)) return error.replace(/^\w*Error: /u, '')
  }
  return undefined
}
