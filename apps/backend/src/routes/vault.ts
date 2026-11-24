import { Hono } from 'hono'
import { z } from 'zod'

import { DEVICE_CREDENTIAL_PREFIX, hashDeviceSecret } from '@/lib/agent/devices/join-tokens'
import { findAgentDeviceByCredentialHash } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { getNuphosUserForCredential } from '@/lib/identity'
import { zv } from '@/lib/validate'
import {
  MAX_DEVICES,
  MAX_ITEMS,
  addVaultDevice,
  approveVaultDevice,
  deleteVaultItem,
  getVaultItem,
  listVaultDevices,
  listVaultItems,
  putVaultItem,
  removeVaultDevice,
} from '@/lib/vault'
import { getVaultItemForComputer } from '@/lib/vault-computer'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'

// A user's own vault. Only a signed-in user session reaches these: conversation
// tokens are not accepted by requireAuth, so an agent never reads a vault. The one
// exception is the computer read below.
export const vaultRoutes = new Hono<{ Variables: AuthVariables }>()

// A computer added from afar (POST /teams/:teamId/computers/:deviceId/vault) reads an
// item with its own device credential, and only with the key of the approved device
// linked to it. Registered before requireAuth, which refuses device credentials.
vaultRoutes.get('/computer/items/:name', async (c) => {
  const header = c.req.header('Authorization') ?? ''
  const device = header.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)
    ? await findAgentDeviceByCredentialHash(hashDeviceSecret(header.slice('Bearer '.length)))
    : null
  // As for its tunnel: a person's computer stops when they sign out everywhere.
  const live =
    device &&
    (device.box ||
      (device.credentialIssuedAt &&
        (await getNuphosUserForCredential(device.userId, device.credentialIssuedAt))))

  if (!device || !live) throw new AppError(401, 'unauthorized', 'Invalid device credential')
  const computer = { userId: device.userId, deviceId: device.deviceId }

  return c.json(
    await getVaultItemForComputer(
      c.req.query('user') ?? '',
      computer,
      nameParam(c.req.param('name')),
    ),
  )
})

vaultRoutes.use('*', requireAuth)

const base64 = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
const x25519Key = base64(44).refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'An X25519 public key is 32 bytes',
})
// Starts with a letter or digit, so `.` and `..` never reach a URL path.
const itemName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
// A wrapped 32-byte key: HPKE encapsulated key, ciphertext and tag.
const wrapped = base64(256)

function nameParam(value: string): string {
  if (!itemName.safeParse(value).success) throw new AppError(404, 'not_found', 'Item not found')

  return value
}

vaultRoutes.get('/devices', async (c) =>
  c.json({ devices: await listVaultDevices(c.get('userId')) }),
)

vaultRoutes.post(
  '/devices',
  zv('json', z.object({ name: z.string().trim().min(1).max(64), publicKey: x25519Key })),
  async (c) => {
    const { name, publicKey } = c.req.valid('json')

    return c.json({ device: await addVaultDevice(c.get('userId'), name, publicKey) }, 201)
  },
)

vaultRoutes.post(
  '/devices/:id/approve',
  zv('json', z.object({ keys: z.array(z.object({ name: itemName, wrapped })).max(MAX_ITEMS) })),
  async (c) => {
    const device = await approveVaultDevice(
      c.get('userId'),
      c.req.param('id'),
      c.req.valid('json').keys,
    )

    return c.json({ device })
  },
)

vaultRoutes.delete('/devices/:id', async (c) => {
  await removeVaultDevice(c.get('userId'), c.req.param('id'))

  return c.body(null, 204)
})

vaultRoutes.get('/items', async (c) => c.json({ items: await listVaultItems(c.get('userId')) }))

vaultRoutes.get('/items/:name', async (c) =>
  c.json({ item: await getVaultItem(c.get('userId'), nameParam(c.req.param('name'))) }),
)

vaultRoutes.put(
  '/items/:name',
  zv(
    'json',
    z.object({
      // 64 KiB of plaintext, base64 with nonce and tag.
      ciphertext: base64(90_000),
      keys: z
        .array(z.object({ deviceId: z.string().uuid(), wrapped }))
        .min(1)
        .max(MAX_DEVICES),
    }),
  ),
  async (c) => {
    const { ciphertext, keys } = c.req.valid('json')
    const item = await putVaultItem(
      c.get('userId'),
      nameParam(c.req.param('name')),
      ciphertext,
      keys,
    )

    return c.json({ item })
  },
)

vaultRoutes.delete('/items/:name', async (c) => {
  await deleteVaultItem(c.get('userId'), nameParam(c.req.param('name')))

  return c.body(null, 204)
})
