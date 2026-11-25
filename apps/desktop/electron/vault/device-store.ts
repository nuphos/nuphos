// Where this app keeps its vault key: where the packaged app keeps the session
// token, or, in a dev build, a file only this user can read.

import fs from 'node:fs/promises'
import path from 'node:path'

import { signedIn } from '../account-request.ts'
import { buildAtlasError } from '../atlas/error.ts'
import { keychainFor, secureStorageEnabled } from '../auth/token-store.ts'
import { readYaml, writeYaml } from '../auth/yaml-file.ts'
import { DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

type Device = { deviceId: string; privateKey: string }

/** This app's own item: the CLI's is `ai.nuphos.vault.device`, so neither asks for the other's. */
const keychain = keychainFor('ai.nuphos.desktop.vault')

/** A failure worth showing as written: the toast shows only errors with a code. */
export const fail = (message: string) => buildAtlasError(message, 'vault_desktop')

async function account() {
  const { api, userId } = await signedIn()

  if (!userId) throw fail('Sign in again to use the vault.')

  return {
    item: `${userId}@${api}`,
    file: path.join(path.dirname(DESKTOP_CONFIG_PATH), `vault-${userId}.yaml`),
  }
}

export async function loadDevice(): Promise<Device | null> {
  const { item, file } = await account()

  if (secureStorageEnabled()) {
    const stored = await keychain.get(item)

    return stored ? (JSON.parse(stored) as Device) : null
  }
  const stored = await readYaml<Partial<Device>>(file)

  return stored?.deviceId && stored.privateKey ? (stored as Device) : null
}

export async function saveDevice(device: Device): Promise<void> {
  const { item, file } = await account()

  if (secureStorageEnabled()) await keychain.set(item, JSON.stringify(device))
  else await writeYaml(file, device)
}

export async function forgetDevice(): Promise<void> {
  const { item, file } = await account()

  if (secureStorageEnabled()) await keychain.delete(item).catch(() => null)
  else await fs.rm(file, { force: true })
}
