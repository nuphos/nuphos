import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'

import { CLOUD_CLIS, isCloudCliProvider } from '../../src/lib/cloudCli.ts'

import type { CloudCliProbe } from '../../src/lib/cloudCli.ts'

/** Find fixed CLI names on PATH without executing them or reading credentials. */
export async function findCloudCli(
  provider: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<CloudCliProbe> {
  if (!isCloudCliProvider(provider)) throw new Error('Unsupported cloud CLI provider')

  return findExecutable(CLOUD_CLIS[provider].commands, env, platform)
}

/** The absolute path of the first of `commands` found on PATH. */
export async function findExecutable(
  commands: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<CloudCliProbe> {
  const windows = platform === 'win32'
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean)
  const suffixes = windows ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : ['']

  for (const command of commands) {
    for (const dir of dirs) {
      for (const suffix of suffixes) {
        const candidate = (windows ? path.win32 : path.posix).join(
          dir.replace(/^"|"$/g, ''),
          command + suffix,
        )

        try {
          if (!(await stat(candidate)).isFile()) continue
          await access(candidate, windows ? constants.F_OK : constants.X_OK)

          return { installed: true, command, path: candidate }
        } catch {
          // Missing, inaccessible, or not executable: try the next PATH entry.
        }
      }
    }
  }

  return { installed: false, command: null, path: null }
}
