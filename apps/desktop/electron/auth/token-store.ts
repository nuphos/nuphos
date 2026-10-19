// Where the session token is kept. On macOS it is a generic password in the
// login keychain, so desktop.yaml keeps only who is signed in. This app and
// the CLI (`apps/cli/src/secret.rs`) each keep their own item: macOS trusts an
// item's creator, so neither asks when it reads its own. Elsewhere the token
// stays in the file (mode 0600).

/** This app's item; the account names the user and backend. The CLI's is `ai.nuphos.cli.session`. */
export const KEYCHAIN_SERVICE = 'ai.nuphos.desktop.session'

export type TokenStore = {
  get: (account: string) => Promise<string | null>
  /** Updates the item in place when it exists: replacing it would reset the
   *  apps it trusts, and macOS would ask again for each of them. */
  set: (account: string, token: string) => Promise<void>
  delete: (account: string) => Promise<void>
}

/**
 * Whether a new token goes to the keychain. `NUPHOS_INSECURE_STORAGE=1` keeps
 * it in cli.yaml, as in the CLI; a token already in the keychain is still read.
 */
export function secureStorageEnabled(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const optOut = env.NUPHOS_INSECURE_STORAGE

  return platform === 'darwin' && (!optOut || optOut === '0')
}

async function entry(account: string) {
  // Loaded on first use: the native module exists only in the packaged
  // dependencies, and only macOS needs it today.
  const { AsyncEntry } = await import('@napi-rs/keyring')

  return new AsyncEntry(KEYCHAIN_SERVICE, account)
}

export const keychainStore: TokenStore = {
  get: async (account) => (await entry(account)).getPassword(),
  set: async (account, token) => {
    await (await entry(account)).setPassword(token)
  },
  delete: async (account) => {
    await (await entry(account)).deletePassword()
  },
}
