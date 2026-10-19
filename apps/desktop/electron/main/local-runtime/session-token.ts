// The session token for `nuphos agent`'s host, which runs on plain Node. A
// token in the keychain (cli.yaml names it) is read through the CLI
// (`NUPHOS_CLI_BIN`), which the keychain trusts, and again only when the file
// changes: the host checks every few seconds whether it is still signed in.

import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

import yaml from 'js-yaml'

type RunCli = () => { status: number | null; stdout: string }

const runCli: RunCli = () =>
  spawnSync(process.env.NUPHOS_CLI_BIN || 'nuphos', ['auth', 'token'], {
    encoding: 'utf8',
    timeout: 10_000,
  })

let last: { stamp: string; token: string | null } | null = null

export function readSessionToken(configPath: string, cli: RunCli = runCli): string | null {
  let data: string
  let stamp: string

  try {
    data = readFileSync(configPath, 'utf8')
    stamp = `${String(statSync(configPath).mtimeMs)}:${data}`
  } catch {
    return null
  }
  const cfg = (yaml.load(data) as { token?: string; keychainAccount?: string } | null) ?? {}

  if (cfg.token) return cfg.token
  if (!cfg.keychainAccount) return null
  if (last?.stamp === stamp) return last.token
  const out = cli()

  // Exit 1 is signed out; a CLI that failed to run says nothing, so keep the last answer.
  if (out.status === 0) last = { stamp, token: out.stdout.trim() || null }
  else if (out.status === 1) last = { stamp, token: null }

  return last?.token ?? null
}
