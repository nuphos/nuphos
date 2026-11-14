// Hermes Agent keeps everything it has (sessions, the skills it writes, its own memory)
// in HERMES_HOME, and runs every session's tools in one background daemon per
// HERMES_HOME, which keeps the environment of the `hermes acp` that started it. So each
// session home, that is each conversation and each teammate acting in it, gets a Hermes
// profile of its own: its daemon only ever holds that conversation's token and
// connector credentials.
//
// A profile signs in with the root's login (~/.hermes/auth.json) but reads only its own
// config, so the model the sign-in chose is copied from the root's config into it.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// - standalone: the profile's own daemon, not one in the root serving every profile.
// - The daemon exits 30 s after the conversation's agent stops, not after 10 minutes.
// - Hermes's long-term memory is off: Nuphos memory, over MCP, is the only one.
// - Its own connectors, schedules, chat platforms and browser download are left out.
// - No on-demand installs: they build a second environment, without ACP, and move to it.
const SETTINGS = (skills) => `gateway:
  standalone: true
  unmanaged_idle_exit_seconds: 30
platform_toolsets:
  acp: [terminal, file, web, vision, todo, skills, code_execution, delegation]
memory:
  memory_enabled: false
  user_profile_enabled: false
auxiliary:
  background_review:
    enabled: false
curator:
  enabled: false
skills:
  external_dirs: [${JSON.stringify(skills)}]
auth:
  adopt_external_logins: false
security:
  allow_lazy_installs: false
updates:
  check: false
plugins:
  auto_update_check_hours: 0
`

/** The top-level `model:` block of a Hermes config, as written by `hermes config set`. */
export function modelBlock(config) {
  return /^model:.*(?:\n[ \t].*)*/mu.exec(config)?.[0] ?? ''
}

/** Prepares the profile for `sessionHome` and returns its HERMES_HOME. */
export function hermesProfile(runtimeHome, sessionHome, workspace = process.cwd()) {
  const root = join(runtimeHome, '.hermes')
  // Hermes accepts at most 64 characters of [a-z0-9_-]: a teammate's home name is longer.
  const home = join(root, 'profiles', createHash('sha256').update(sessionHome).digest('hex'))
  mkdirSync(home, { recursive: true, mode: 0o700 })
  let rootConfig = ''
  try {
    rootConfig = readFileSync(join(root, 'config.yaml'), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const model = modelBlock(rootConfig)
  const config = `${model ? `${model}\n` : ''}${SETTINGS(join(workspace, '.agents', 'skills'))}`
  const file = join(home, 'config.yaml')
  const temporary = `${file}.${String(process.pid)}.tmp`
  writeFileSync(temporary, config, { mode: 0o600 })
  renameSync(temporary, file)
  return home
}
