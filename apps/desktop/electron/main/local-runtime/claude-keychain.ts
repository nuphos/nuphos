import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'

/** The Keychain entry Claude keeps a sign-in in, selected by its secure-storage dir. */
export function claudeKeychainService(env: NodeJS.ProcessEnv): string {
  const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR

  return `Claude Code-credentials${
    storageDir
      ? `-${createHash('sha256').update(storageDir.normalize('NFC')).digest('hex').slice(0, 8)}`
      : ''
  }`
}

/** `security` exits with errSecItemNotFound once no entry matches. */
const ITEM_NOT_FOUND = 44

/** Drops every Keychain entry of an added agent; the default sign-in is never selected here.
 *  The service names that agent alone, whatever account a sign-in stored the entry under.
 *  Throws when an entry may be left, so the agent is never reported signed out while it is not. */
export async function deleteClaudeKeychainEntry(env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform !== 'darwin' || !env.CLAUDE_SECURESTORAGE_CONFIG_DIR) return
  const service = claudeKeychainService(env)

  // Each call deletes one matching entry, until none is left.
  for (let deleted = true, left = 8; deleted && left > 0; left -= 1)
    deleted = await new Promise<boolean>((resolve, reject) => {
      execFile(
        '/usr/bin/security',
        ['delete-generic-password', '-s', service],
        { timeout: 15_000 },
        (error) => {
          if (!error || (error as { code?: unknown }).code === ITEM_NOT_FOUND) resolve(!error)
          else
            reject(new Error(`Could not delete the Keychain entry "${service}": ${error.message}`))
        },
      )
    })
}
