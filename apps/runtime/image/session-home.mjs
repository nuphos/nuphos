import { createHash as nuphosHomeHash } from 'node:crypto'
import { mkdirSync as nuphosMkdir, lstatSync as nuphosLstat } from 'node:fs'
import { homedir as nuphosHostHome } from 'node:os'
import { join as nuphosJoin, delimiter as nuphosPathDelimiter } from 'node:path'

// Configuration isolation, not a filesystem security boundary: sessions still
// run as the same OS user. Never mutate process.env or copy ambient credentials.
// Use the conversation ID, not the ACP process/turn ID, so load/resume and token
// refresh keep the same home. Hash it so metadata cannot supply a filesystem path.
export function nuphosSessionHomeEnv(sessionEnv = {}, runtimeEnv = process.env) {
  const id = sessionEnv.NUPHOS_SESSION_ID
  if (typeof id !== 'string' || !id.trim()) {
    if (sessionEnv.NUPHOS_TOKEN || sessionEnv.NUPHOS_TEAM_ID)
      throw new Error('Nuphos sessions require NUPHOS_SESSION_ID for CLI configuration isolation')
    return {} // Ordinary ACP clients without a Nuphos conversation keep their defaults.
  }
  const runtimeHome = runtimeEnv.HOME || runtimeEnv.USERPROFILE || nuphosHostHome()
  const root = nuphosJoin(runtimeHome, '.nuphos', 'session-homes')
  const home = nuphosJoin(root, nuphosHomeHash('sha256').update(id).digest('hex'))
  for (const dir of [root, home]) {
    nuphosMkdir(dir, { recursive: true, mode: 0o700 })
    if (!nuphosLstat(dir).isDirectory()) throw new Error('Session home must be a directory')
  }
  const config = nuphosJoin(home, '.config')
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: nuphosJoin(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: nuphosJoin(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: nuphosJoin(home, '.cache'),
    XDG_DATA_HOME: nuphosJoin(home, '.local', 'share'),
    XDG_STATE_HOME: nuphosJoin(home, '.local', 'state'),
    CLOUDSDK_CONFIG: nuphosJoin(config, 'gcloud'),
    GH_CONFIG_DIR: nuphosJoin(config, 'gh'),
    AWS_SHARED_CREDENTIALS_FILE: nuphosJoin(home, '.aws', 'credentials'),
    AWS_CONFIG_FILE: nuphosJoin(home, '.aws', 'config'),
    KUBECONFIG: nuphosJoin(home, '.kube', 'config'),
    AZURE_CONFIG_DIR: nuphosJoin(home, '.azure'),
    DOCKER_CONFIG: nuphosJoin(home, '.docker'),
    GIT_CONFIG_GLOBAL: nuphosJoin(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    NPM_CONFIG_USERCONFIG: nuphosJoin(home, '.npmrc'),
    GNUPGHOME: nuphosJoin(home, '.gnupg'),
    PATH: [nuphosJoin(home, '.local', 'bin'), runtimeEnv.PATH]
      .filter(Boolean)
      .join(nuphosPathDelimiter),
    NUPHOS_SESSION_HOME: home,
  }
}

// Claude's own login/session store belongs to the runtime. Pin its location
// before giving the SDK child (and its shell tools) the conversation's HOME.
export function nuphosClaudeSessionEnv(env, sessionEnv, runtimeEnv = process.env) {
  const isolated = nuphosSessionHomeEnv(sessionEnv, runtimeEnv)
  if (!isolated.HOME) return env
  return {
    ...env,
    CLAUDE_CONFIG_DIR:
      runtimeEnv.CLAUDE_CONFIG_DIR ||
      nuphosJoin(runtimeEnv.HOME || runtimeEnv.USERPROFILE || nuphosHostHome(), '.claude'),
    ...isolated,
  }
}
