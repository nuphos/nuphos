/** True when a segment writes to a file/device via redirection. Ignores the
 *  harmless `>/dev/null`, `2>&1`, `>&2` forms. Any other `>` / `>>` is a write. */
export function hasOutputRedirection(segment: string): boolean {
  // strip harmless forms first
  const cleaned = segment
    .replace(/\d?>&\d/g, ' ') // 2>&1, >&2
    .replace(/\d?>>?\s*\/dev\/null/g, ' ') // >/dev/null, 2>>/dev/null

  return /(^|[^0-9&])>>?/.test(cleaned)
}
// Command-wrappers whose NEXT token is another command — unwrap to it
// (sudo kubectl ..., timeout 5 kubectl ...). `sudo` is here so the wrapped
// command is still judged, not blindly allowed.
const WRAPPER_LEADERS = new Set<string>([
  'command',
  'time',
  'timeout',
  'nohup',
  'sudo',
  'env',
  'stdbuf',
  'nice',
  'ionice',
  'xargs',
])

/** Split a command into top-level segments on && || ; | and newlines. */
export function splitSegments(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let quote: string | null = null

  while (i < command.length) {
    const ch = command[i]!
    const next = command[i + 1]

    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      cur += ch
      i++
      continue
    }
    // A lone `&` is NOT a separator here: it's part of `2>&1` / `>&2` (fd
    // redirection) or a background marker — splitting on it would shred those.
    // Only `&&` separates. `|`, `;`, newline always separate.
    const isSep = ch === '\n' || ch === ';' || ch === '|' || (ch === '&' && next === '&')

    if (isSep) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      // consume the operator run (&&, ||, |, ;, newlines)
      while (i < command.length) {
        const cc = command[i]!

        if (cc === '|' || cc === ';' || cc === '\n' || (cc === '&' && command[i + 1] === '&')) {
          i += cc === '&' ? 2 : 1
        } else break
      }
      continue
    }
    cur += ch
    i++
  }
  if (cur.trim()) out.push(cur.trim())

  return out
}

/** One leading `-f` / `--flag[=value| value]` of a command-wrapper. */
const WRAPPER_FLAG_RE = /^-{1,2}[A-Za-z][\w-]*(=\S+|\s+\S+)?\s+/

/** The effective binary of a segment after stripping VAR= assignments and
 *  unwrapping command-wrappers, plus the arguments that follow it. */
export function effectiveCommand(segment: string): { bin: string; rest: string } {
  let s = segment.trim()

  // strip a run of `VAR=value` assignments
  while (/^[A-Za-z_]\w*=[^\s]*(\s+|$)/.test(s)) s = s.replace(/^[A-Za-z_]\w*=[^\s]*(\s+|$)/, '')
  let m = /^([A-Za-z0-9_./-]+)/.exec(s)
  let bin = m ? m[1]! : ''
  // unwrap command-wrappers only (sudo/timeout/env/xargs …), NOT standalone
  // builtins like cd whose args are paths, not commands.
  let guard = 0

  while (WRAPPER_LEADERS.has(bin) && guard++ < 5) {
    let after = s.slice(bin.length).trim()

    // drop wrapper flags/args that aren't the inner command:
    //   timeout 5s, nice -n 10, env FOO=bar, xargs -I{}
    // leading -flags, one at a time (a `(...)+` run made the pattern unreadable)
    while (WRAPPER_FLAG_RE.test(after)) after = after.replace(WRAPPER_FLAG_RE, '')
    after = after.replace(/^\d+[a-z]?\s+/, '') // timeout duration
    while (/^[A-Za-z_]\w*=[^\s]*(\s+|$)/.test(after))
      after = after.replace(/^[A-Za-z_]\w*=[^\s]*(\s+|$)/, '') // env VAR=
    const mm = /^([A-Za-z0-9_./-]+)/.exec(after)
    const nb = mm ? mm[1]! : ''

    if (nb === '' || nb === bin) break
    s = after
    bin = nb
  }
  m = /^([A-Za-z0-9_./-]+)/.exec(s)
  const finalBin = m ? m[1]! : ''
  const rest = s.slice(finalBin.length).trim()

  return { bin: finalBin, rest }
}

// ssh flags that cannot change what the connection *is*. Anything outside these
// sets — port forwards, `-o` overrides that smuggle in a ProxyCommand, jump
// hosts, agent forwarding — leaves the read-only fast path.
//
// An allowlist, because denying by pattern missed the attached-value forms:
// `-D1080` and `-oProxyCommand=…` have no word boundary after the flag letter,
// so a `\b`-anchored regex waved them through and auto-approved a command that
// opens a SOCKS proxy. An unknown flag now costs a judge call instead of
// silently earning trust.
// `-F` is deliberately absent: an alternate config file can set
// ProxyCommand, which is the very thing `-o` is kept out for. It needs a
// prior write to be useful, but the classifier's job is to not depend on that.
const SSH_SAFE_VALUE_FLAGS = new Set(['-p', '-l', '-i', '-c', '-m'])
const SSH_SAFE_BARE_FLAGS = new Set(['-4', '-6', '-C', '-q', '-n', '-T', '-a', '-x'])

/**
 * Split `ssh [flags] destination <remote command>` into the remote command.
 * Returns null when there is no remote command (an interactive shell), which
 * is never read-only.
 *
 * Without this every `ssh host 'df -h'` would be judged by the LLM purely
 * because of the wrapper, and — worse — a reviewer of the judge's decision
 * would be reasoning about an opaque string rather than the command that
 * actually runs on the customer's machine.
 */
export function sshRemoteCommand(rest: string): string | null {
  let s = rest.trim()

  while (s.startsWith('-')) {
    const token = /^(\S+)/.exec(s)?.[1]

    if (!token) return null
    const flag = token.slice(0, 2)

    if (SSH_SAFE_BARE_FLAGS.has(token)) {
      s = s.slice(token.length).trim()
      continue
    }
    if (!SSH_SAFE_VALUE_FLAGS.has(flag)) return null
    s = s.slice(flag.length).trim()
    // `-p2222` attaches its value; `-p 2222` takes the next token.
    if (token.length > 2) {
      s = s.slice(token.length - flag.length).trim()
      continue
    }
    const value = /^(\S+)/.exec(s)?.[1]

    if (!value) return null
    s = s.slice(value.length).trim()
  }
  // destination
  const destination = /^(\S+)/.exec(s)?.[1]

  if (!destination) return null
  s = s.slice(destination.length).trim()
  if (!s) return null
  const quote = s[0]

  if ((quote === "'" || quote === '"') && s.endsWith(quote) && s.length > 1) {
    return s.slice(1, -1)
  }

  return s
}
