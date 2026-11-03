// Before this app had its own sign-in file it shared cli.yaml with the CLI.

import { readYaml, writeYaml } from './yaml-file.ts'

import type { StoredAccount } from './accounts.ts'

type AdoptDeps = {
  legacyPath?: string
  /** The backend the app starts on, which made cli.yaml's sign-in. */
  api: string
  save: (account: StoredAccount) => Promise<void>
  secure: () => boolean
}

/**
 * Starts from cli.yaml's sign-in, once. Where the token goes to the keychain
 * it leaves cli.yaml as well, and `nuphos login` then takes it from here.
 */
export async function adoptLegacySignIn(deps: AdoptDeps): Promise<StoredAccount | null> {
  const legacy = deps.legacyPath ? await readYaml<StoredAccount>(deps.legacyPath) : null

  if (!deps.legacyPath || !legacy?.token) return null
  const account = {
    token: legacy.token,
    api: deps.api,
    user: legacy.user,
    username: legacy.username,
    userInfo: legacy.userInfo,
  }

  await deps.save(account)
  if (deps.secure()) await writeYaml(deps.legacyPath, { ...legacy, token: undefined })

  return account
}
