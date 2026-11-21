import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import {
  addVaultDevice,
  approveVaultDevice,
  deleteVaultItem,
  getVaultItem,
  listVaultDevices,
  listVaultItems,
  putVaultItem,
  removeVaultDevice,
} from '@/lib/vault'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'

// A user's own vault. Only a signed-in user session reaches these: conversation
// tokens are not accepted by requireAuth, so an agent never reads a vault.
export const vaultRoutes = new Hono<{ Variables: AuthVariables }>()

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
const MAX_DEVICES = 50
const MAX_ITEMS = 1000

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
