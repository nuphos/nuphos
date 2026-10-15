import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'

/** The Keychain entry Claude keeps a sign-in in, selected by its secure-storage dir. */
export function claudeKeychainService(env: NodeJS.ProcessEnv): string {
  const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR

  return `Claude Code-credentials${
    storageDir
      ? `-${createHash('sha256').update(storageDir.normalize('NFC')).digest('hex').slice(0, 8)}`
      : ''
  }`
}

/** Drops an added agent's own Keychain entry; the default sign-in is never selected here. */
export async function deleteClaudeKeychainEntry(env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform !== 'darwin' || !env.CLAUDE_SECURESTORAGE_CONFIG_DIR) return
  await new Promise<void>((resolve) => {
    execFile(
      '/usr/bin/security',
      ['delete-generic-password', '-a', os.userInfo().username, '-s', claudeKeychainService(env)],
      { timeout: 15_000 },
      // Nothing stored yet is the same outcome.
      () => resolve(),
    )
  })
}
