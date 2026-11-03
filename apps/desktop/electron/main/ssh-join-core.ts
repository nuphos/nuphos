import { isAbsolute, join } from 'node:path'

import { SSH_TARGET } from '../../src/lib/sshTarget.ts'

import type { SshHost, SshJoinProblem } from '../../src/api/device-types.ts'

const MAX_INCLUDE_DEPTH = 16

/** Splits an ssh_config value into words; double quotes keep spaces. */
function words(value: string): string[] {
  return [...value.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] || m[2])
}

const concrete = (pattern: string) => !/[*?!]/.test(pattern)

function glob(pattern: string, list: (dir: string) => string[]): string[] {
  if (!/[*?]/.test(pattern)) return [pattern]
  const slash = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf('\\'))
  const dir = pattern.slice(0, slash)
  const name = new RegExp(
    `^${pattern
      .slice(slash + 1)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  )

  return list(dir)
    .filter((entry) => name.test(entry))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => join(dir, entry))
}

function directive(line: string): { key: string; args: string[] } | null {
  const key = /^[A-Za-z]+/.exec(line)?.[0]

  if (!key) return null
  let rest = line.slice(key.length).trimStart()

  if (rest.startsWith('=')) rest = rest.slice(1).trimStart()

  return { key: key.toLowerCase(), args: words(rest) }
}

/** An Include path: ~ is the home folder and a relative path is under ~/.ssh. */
function includePath(arg: string, home: string): string {
  if (arg.startsWith('~')) return join(home, arg.slice(1))

  return isAbsolute(arg) ? arg : join(home, '.ssh', arg)
}

/**
 * The Host aliases one could `ssh` to by name, from an ssh_config and the files it Includes:
 * wildcard and negated patterns are left out, and each alias keeps its first HostName and User.
 */
export function sshConfigHosts(
  file: string,
  {
    home,
    read,
    list,
  }: {
    home: string
    read: (path: string) => string | null
    list: (dir: string) => string[]
  },
): SshHost[] {
  const hosts = new Map<string, SshHost>()
  let current: SshHost[] = []

  const enter = (aliases: string[]) => {
    current = aliases.filter(concrete).map((alias) => {
      const host = hosts.get(alias) ?? { alias }

      hosts.set(alias, host)

      return host
    })
  }
  const parse = (path: string, depth: number) => {
    const text = depth > MAX_INCLUDE_DEPTH ? null : read(path)

    for (const raw of text?.split(/\r?\n/) ?? []) {
      const line = raw.trim()
      const found = line.startsWith('#') ? null : directive(line)

      if (found) apply(found, depth)
    }
  }
  const apply = (found: { key: string; args: string[] }, depth: number) => {
    switch (found.key) {
      case 'host':
        enter(found.args)
        break
      case 'match':
        current = []
        break
      case 'hostname':
        for (const host of current) host.hostName ??= found.args[0]
        break
      case 'user':
        for (const host of current) host.user ??= found.args[0]
        break
      case 'include':
        for (const arg of found.args) include(arg, depth)
    }
  }
  const include = (arg: string, depth: number) => {
    for (const included of glob(includePath(arg, home), list)) parse(included, depth + 1)
  }

  parse(file, 0)

  return [...hosts.values()]
}

/** The system's own ssh, never one found on PATH: OpenSSH ships with macOS, Linux and Windows 10+. */
export function sshBinary(platform: NodeJS.Platform, systemRoot = 'C:\\Windows'): string {
  return platform === 'win32' ? `${systemRoot}\\System32\\OpenSSH\\ssh.exe` : '/usr/bin/ssh'
}

/** ssh's arguments to run a shell reading its script from stdin, without ever prompting. */
export function sshJoinArgs(target: string): string[] | null {
  const m = SSH_TARGET.exec(target.trim())

  if (!m) return null

  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    ...(m[2] ? ['-p', m[2]] : []),
    '--',
    m[1],
    'sh -s',
  ]
}

const SAFE = /^[\w.:/-]+$/

/**
 * Installs the CLI and starts its agent with the join token, sent on stdin so the token is in no
 * command line. The agent keeps running after ssh ends and logs to ~/.nuphos-agent.log.
 */
export function sshJoinScript({ token, apiUrl }: { token: string; apiUrl: string | null }): string {
  const api = apiUrl && apiUrl !== 'https://api.nuphos.ai' ? apiUrl : null

  if (!SAFE.test(token) || (api && !SAFE.test(api))) throw new Error('Unexpected join token')
  const env = [api && `NUPHOS_API_URL='${api}'`, `NUPHOS_JOIN_TOKEN='${token}'`]
    .filter(Boolean)
    .join(' ')

  return [
    'set -e',
    // The CLI is run by its full path, so the installer has no PATH advice to give.
    'curl -fsSL https://nuphos.ai/install | PATH="$HOME/.local/bin:$PATH" sh',
    'test -x "$HOME/.local/bin/nuphos" || { echo "The Nuphos CLI did not install." >&2; exit 1; }',
    `${env} nohup "$HOME/.local/bin/nuphos" agent >"$HOME/.nuphos-agent.log" 2>&1 </dev/null &`,
    'agent=$!',
    'cred="$HOME/.local/share/nuphos/agent/device-credential.json"',
    // An agent that cannot start (no Node.js, a refused token) exits at once: say why now.
    'sleep 5',
    'i=0; while [ $i -lt 60 ] && [ ! -s "$cred" ] && kill -0 $agent 2>/dev/null; do sleep 1; i=$((i+1)); done',
    'kill -0 $agent 2>/dev/null || { cat "$HOME/.nuphos-agent.log" >&2; exit 1; }',
    'echo "Started the Nuphos agent. Its log is ~/.nuphos-agent.log."',
    // Which computer it is, so Desktop waits for this one: new, joined again or already there.
    'sed -n \'s/.*"deviceId": *"\\([^"]*\\)".*/Device: \\1/p\' "$cred"',
    '',
  ].join('\n')
}

/** The computer the script reported, from its `Device: <id>` line. */
export function sshJoinDevice(stdout: string): string | null {
  return /^Device: ([\w-]+)$/m.exec(stdout)?.[1] ?? null
}

/** Why an ssh run failed. Only exit 255 is ssh's own failure; anything else came from the script. */
export function sshJoinProblem(code: number | null, stderr: string): SshJoinProblem {
  if (code !== 255) return 'failed'
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr))
    return 'host-key'
  if (/Permission denied|Too many authentication failures/i.test(stderr)) return 'auth'

  return 'unreachable'
}
