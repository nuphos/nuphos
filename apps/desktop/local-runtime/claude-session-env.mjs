import {
  constants as nuphosDesktopFs,
  mkdirSync as nuphosDesktopMkdir,
  writeFileSync as nuphosDesktopWrite,
} from 'node:fs'
import { join as nuphosDesktopJoin } from 'node:path'

/** macOS needs the host HOME for Keychain; only tool commands get the session HOME. */
export function nuphosDesktopClaudeEnv(
  isolated,
  runtimeEnv = process.env,
  platform = process.platform,
) {
  if (platform !== 'darwin' || !isolated.HOME) return isolated
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
  const wrapper = nuphosDesktopJoin(isolated.HOME, 'tool-shell.sh')
  nuphosDesktopMkdir(isolated.HOME, { recursive: true, mode: 0o700 })
  nuphosDesktopWrite(
    wrapper,
    '#!/bin/sh\n' +
      Object.entries(isolated)
        .map(([key, value]) => `export ${key}=${quote(value)}\n`)
        .join('') +
      'exec /bin/sh -c "$1"\n',
    {
      mode: 0o700,
      flag:
        nuphosDesktopFs.O_WRONLY |
        nuphosDesktopFs.O_CREAT |
        nuphosDesktopFs.O_TRUNC |
        nuphosDesktopFs.O_NOFOLLOW,
    },
  )
  return {
    ...isolated,
    HOME: runtimeEnv.HOME,
    USERPROFILE: runtimeEnv.USERPROFILE ?? runtimeEnv.HOME,
    CLAUDE_CODE_SHELL_PREFIX: wrapper,
    // Non-interactive bash avoids the host's zshenv as well as login profiles.
    CLAUDE_CODE_SHELL: '/bin/bash',
    CLAUDE_CODE_SHELL_SKIP_LOGIN: '1',
    CLAUDE_CODE_DISABLE_SHELL_SNAPSHOT: '1',
  }
}
