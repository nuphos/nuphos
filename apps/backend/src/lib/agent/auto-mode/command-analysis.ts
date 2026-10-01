// Deterministic read-only detection for Auto Mode. Answers ONE question the
// LLM judge shouldn't be paid to answer: is this command trivially read-only?
// Conservative: readOnly is true only when certain (no dynamic structure,
// every segment a known read-only command); everything else → the judge.

import {
  effectiveCommand,
  hasOutputRedirection,
  splitSegments,
  sshRemoteCommand,
} from './command-analysis-segments'
import { MUTATING_TOKENS, READ_ONLY_BINARIES, READ_ONLY_VERBS } from './command-analysis-tables'

export type CommandAnalysis = {
  /** Confidently read-only across every top-level segment. Safe to auto-allow. */
  readOnly: boolean
  /** Contains dynamic structure static analysis can't see through. */
  opaque: boolean
  /** Top-level segments after splitting on operators/pipes/newlines. */
  segments: string[]
}

export { splitSegments } from './command-analysis-segments'

// Structure that hides what actually runs from static analysis. Presence means
// we can never claim readOnly (the real behaviour is in a script body / a
// substituted command we can't inspect).
const OPAQUE_PATTERNS: RegExp[] = [
  /\$\((?!\()/, // $( command substitution (not arithmetic $(( )) )
  /`[^`]/, // backtick command substitution
  /<\(|>\(/, // process substitution
  /\|\s*(bash|sh|zsh|python3?|node|deno|bun|ruby|perl|jq\s+-[a-z]*[nef])/, // pipe into interpreter
  /\b(bash|sh|zsh|python3?|node|deno|bun|ruby|perl)\s+-c\b/, // interpreter -c "<script>"
  /<<-?\s*['"]?[A-Za-z_]/, // heredoc
  /\beval\b/,
]

// Standalone builtins whose ARGUMENTS are not commands — the segment is
// harmless on its own (cd /path, export X=1). Never unwrap into their args.
// NOTE: `source` / `.` are deliberately NOT here — they execute a script whose
// contents static analysis can't see, so they must fall through to the judge.
const STANDALONE_NEUTRAL = new Set<string>(['cd', 'set', 'export', 'unset', 'pushd', 'popd', ':'])

function segmentReadOnly(segment: string, depth = 0): boolean {
  const raw = segment.trim()

  if (!raw) return true
  // A bare VAR= assignment segment (no command after it)
  if (/^[A-Za-z_]\w*=\S*$/.test(raw)) return true
  // Any output redirection to a file/device is a write.
  if (hasOutputRedirection(raw)) return false
  const first = /^([A-Za-z0-9_./-]+)/.exec(raw)?.[1] ?? ''

  if (STANDALONE_NEUTRAL.has(first)) return true
  const { bin, rest } = effectiveCommand(raw)

  if (bin === '' || STANDALONE_NEUTRAL.has(bin)) return true
  if (bin === 'ssh') {
    if (depth > 0) return false
    const remote = sshRemoteCommand(rest)

    if (remote === null) return false
    const analysis = analyzeCommand(remote, depth + 1)

    return analysis.readOnly
  }
  if (!READ_ONLY_BINARIES.has(bin)) return false
  // Defense-in-depth: a mutating sub-subcommand token anywhere disqualifies.
  if (rest.split(/\s+/).some((t) => MUTATING_TOKENS.has(t))) return false
  const s = `${bin} ${rest}`.trim()
  // If the CLI has a verb table, the verb must be read-only.
  const verbs = READ_ONLY_VERBS[bin]

  if (verbs) {
    // effective args after the binary
    const rest = s.slice(s.indexOf(bin) + bin.length).trim()
    const verb = /^([a-z][a-z-]*)/.exec(rest)?.[1]

    if (!verb) return true // `kubectl` alone, `git` alone — harmless
    if (bin === 'aws' || bin === 'gcloud') {
      // aws <service> <verb ...>; the verb is the 2nd token
      const tokens = rest.split(/\s+/)
      const v = tokens[1] ?? ''

      return /^(describe|list|get|ls|search|help)/.test(v) || v === ''
    }
    if (bin === 'gh') {
      // gh api with -X/-f/--method POST is a write; plain gh api / gh pr view etc. read
      if (
        /\bapi\b/.test(rest) &&
        /(-X\s*(POST|PUT|PATCH|DELETE)|--method\s*(POST|PUT|PATCH|DELETE)|-f\s|--field\s)/i.test(
          rest,
        )
      )
        return false

      return verbs.has(verb)
    }
    if (bin === 'git') {
      if (verb === 'config' && /\s/.test(rest.slice(6).trim())) return false // git config --set-ish

      return verbs.has(verb)
    }

    return verbs.has(verb)
  }
  // curl/wget: a write if it uses a mutating method or uploads
  if (bin === 'curl') {
    return !/(-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)|-d\b|--data|-T\b|--upload-file)/i.test(
      s,
    )
  }
  // psql/mysql -c '<sql>' — read only if SQL is a SELECT/SHOW and nothing else
  if (bin === 'psql' || bin === 'mysql' || bin === 'mongosh' || bin === 'redis-cli') {
    return !/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|flushall|flushdb|set)\b/i.test(
      s,
    )
  }
  // journalctl reads, except for the flags that prune or rotate the journal
  if (bin === 'journalctl' && /--(vacuum-\w+|rotate|flush|sync|relinquish-var)\b/.test(s))
    return false
  // sed writes in place under every spelling of -i: clustered (`-ni`), suffixed
  // (`-i.bak`), and the long form. Matching `--in-place` literally is not
  // enough — getopt_long accepts any unambiguous abbreviation, and `in-place`
  // is sed's only long option starting with `i`, so `--i`, `--in` and `--in-pl`
  // all edit the file too (verified against GNU sed 4.9). Treat any `--i…` as a
  // write: a non-option spelling would just be a sed error, and a false hit
  // only costs a judge call.
  if (bin === 'sed' && /(^|\s)(-[a-zA-Z]*i|--i)/.test(s)) return false

  return true
}

export function analyzeCommand(command: string, depth = 0): CommandAnalysis {
  const segments = splitSegments(command)
  const opaque = OPAQUE_PATTERNS.some((re) => re.test(command))
  // readOnly requires: not opaque, and every segment read-only.
  const readOnly =
    !opaque && segments.length > 0 && segments.every((segment) => segmentReadOnly(segment, depth))

  return { readOnly, opaque, segments }
}
