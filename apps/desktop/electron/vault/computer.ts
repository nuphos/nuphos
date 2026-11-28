// What other people share with the computer Desktop runs on: Desktop is a computer of its
// owner, so it reads as one, with the key its own vault device holds (see vault-computer.ts
// in the backend).

import { call } from '../atlas/client.ts'

import { open } from './crypto.ts'
import { checkName, fail, itemKey, loadDevice } from './vault.ts'

import type { Item } from './vault.ts'

type Owner = { userId: string; name: string }

let linked: string | null = null

/**
 * Who shares `name` with the computer this app runs on, `computer` its device id: its owner
 * too, once this device is in their vault. This device is linked to that computer first, so
 * what another person shares with the computer opens with the key this device holds.
 */
export async function sharers(name: string, computer: string): Promise<Owner[]> {
  const device = await loadDevice()

  if (!device) return []
  const link = `${device.deviceId}:${computer}`

  if (linked !== link) {
    await call(
      'PUT',
      `/vault/devices/${encodeURIComponent(device.deviceId)}/computer`,
      { deviceId: computer },
      { retry: false },
    )
    linked = link
  }
  const path = `/vault/computers/${encodeURIComponent(computer)}/items?name=${checkName(name)}`

  return (await call<{ owners: Owner[] }>('GET', path)).owners
}

/** `name` as `owner` shared it with this computer, opened with this device's key. */
export async function sharedItem(name: string, owner: string, computer: string): Promise<string> {
  const device = await loadDevice()

  if (!device) throw fail('This device is not in a vault.')
  const { deviceId, item } = await call<{ deviceId: string; item: Item }>(
    'GET',
    `/vault/computers/${encodeURIComponent(computer)}/items/${checkName(name)}?user=${encodeURIComponent(owner)}`,
  )
  const privateKey = Buffer.from(device.privateKey, 'base64')

  return open(itemKey(name, item, { deviceId, privateKey }), name, item.ciphertext).toString(
    'utf-8',
  )
}
