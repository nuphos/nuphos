// Where the session token is kept: in the OS credential store, so desktop.yaml
// keeps only who is signed in. That is a generic password in the login
// keychain on macOS, Credential Manager on Windows, and the Secret Service
// (gnome-keyring, KWallet) on Linux. This app and the CLI
// (`apps/cli/src/secret.rs`) each keep their own item: macOS trusts an item's
// creator, so neither asks when it reads its own. A store that refuses the
// write (locked, or a Linux without a Secret Service) leaves the token in the
// file (mode 0600).

/** This app's item; the account names the user and backend. The CLI's is `ai.nuphos.cli.session`. */
export const KEYCHAIN_SERVICE = 'ai.nuphos.desktop.session'

export type TokenStore = {
  get: (account: string) => Promise<string | null>
  /** Updates the item in place when it exists: replacing it would reset the
   *  apps it trusts, and macOS would ask again for each of them. */
  set: (account: string, token: string) => Promise<void>
  delete: (account: string) => Promise<void>
}

const SECURE_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32', 'linux'])

/**
 * Whether a new token goes to the credential store: in the packaged app on
 * macOS, Windows and Linux. A dev build (`electron .`) and plain Node (tests,
 * `nuphos agent`'s host) keep it in the file, so an unsigned binary leaves no
 * items behind.
 */
export function secureStorageEnabled(
  platform: NodeJS.Platform = process.platform,
  proc: { versions: NodeJS.ProcessVersions; defaultApp?: boolean } = process,
): boolean {
  return SECURE_PLATFORMS.has(platform) && Boolean(proc.versions.electron) && !proc.defaultApp
}

/**
 * On Linux only the Secret Service: the kernel keyring the library otherwise
 * falls back to forgets on reboot, which would sign the user out. Without a
 * Secret Service the write throws and the token stays in the file.
 */
export const ENTRY_OPTIONS = { linux: { store: 'secret-service' } } as const

async function entry(service: string, account: string) {
  // Any other binary is not the item's creator, so macOS would ask for the
  // login keychain password: fail instead of reaching the keychain.
  if (!secureStorageEnabled()) throw new Error('the keychain is used only by the packaged app')
  // Loaded on first use: the native module exists only in the packaged
  // dependencies.
  const { AsyncEntry } = await import('@napi-rs/keyring')

  return new AsyncEntry(service, account, ENTRY_OPTIONS)
}

/** The items of one service in the credential store. */
export function keychainFor(service: string): TokenStore {
  return {
    get: async (account) => (await entry(service, account)).getPassword(),
    set: async (account, token) => {
      await (await entry(service, account)).setPassword(token)
    },
    delete: async (account) => {
      await (await entry(service, account)).deletePassword()
    },
  }
}

export const keychainStore: TokenStore = keychainFor(KEYCHAIN_SERVICE)
