import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import {
  MAX_DEVICES,
  addVaultDevice,
  approveVaultDevice,
  deleteVaultItem,
  getVaultItem,
  listVaultDevices,
  listVaultItems,
  putVaultItem,
  removeVaultDevice,
} from '@/lib/vault'
import {
  getVaultItemForComputer,
  offerComputerKey,
  vaultOwnersSharingWithComputer,
} from '@/lib/vault-computer'
import { requireAuth } from '@/middleware/auth'
import { liveDevice } from '@/routes/agent/router'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

// A user's own vault, end-to-end encrypted: the server stores only ciphertext, wrapped
// item keys and device public keys, so it can never decrypt an item. Whatever reaches
// these routes gets only that. A signed-in session reaches them, except the computer
// read below.
export const vaultRoutes = new Hono<{ Variables: AuthVariables }>()

// A computer reaches three routes with its own device credential, registered before
// requireAuth, which refuses one. When it joins, it offers its own key to its
// owner's vault; once a device linked to it is approved, it reads an item with that
// device's key only. It also asks whose vaults share an item with it, to run each
// one's shared Claude Code token as its own agent.
vaultRoutes.post('/computer/devices', (c) => offerKeyFromComputer(c))
vaultRoutes.get('/computer/items', (c) => listComputerSharers(c))
vaultRoutes.get('/computer/items/:name', (c) => readComputerItem(c))

async function computerOf(c: Context, live: typeof liveDevice) {
  const found = await live(c.req.header('Authorization'))

  if (!found) throw new AppError(401, 'unauthorized', 'Invalid device credential')

  return found.device
}

/** Separate from the route so its credential check can be tested without a database. */
export async function offerKeyFromComputer(
  c: Context,
  deps: { liveDevice: typeof liveDevice; offer: typeof offerComputerKey } = {
    liveDevice,
    offer: offerComputerKey,
  },
) {
  const device = await computerOf(c, deps.liveDevice)
  const body = z.object({ publicKey: x25519Key }).safeParse(await c.req.json().catch(() => null))

  if (!body.success) throw new AppError(400, 'bad_request', 'Invalid public key')

  return c.json({ device: await deps.offer(device, body.data.publicKey) }, 201)
}

/** Separate from the route so its credential check can be tested without a database. */
export async function readComputerItem(
  c: Context,
  deps: { liveDevice: typeof liveDevice; getItem: typeof getVaultItemForComputer } = {
    liveDevice,
    getItem: getVaultItemForComputer,
  },
) {
  const { userId, deviceId } = await computerOf(c, deps.liveDevice)

  return c.json(
    await deps.getItem(
      c.req.query('user') ?? '',
      { userId, deviceId },
      nameParam(c.req.param('name') ?? ''),
    ),
  )
}

/** Separate from the route so its credential check can be tested without a database. */
export async function listComputerSharers(
  c: Context,
  deps: { liveDevice: typeof liveDevice; owners: typeof vaultOwnersSharingWithComputer } = {
    liveDevice,
    owners: vaultOwnersSharingWithComputer,
  },
) {
  const { userId, deviceId } = await computerOf(c, deps.liveDevice)

  return c.json({
    owners: await deps.owners({ userId, deviceId }, nameParam(c.req.query('name') ?? '')),
  })
}

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
  // Approval wraps nothing; an older client's `keys` are dropped unread.
  async (c) => {
    const device = await approveVaultDevice(c.get('userId'), c.req.param('id'))

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
      /** The item's `updatedAt` as the writer read it, null for a new item. */
      updatedAt: z.string().datetime().nullable(),
    }),
  ),
  async (c) => {
    const { ciphertext, keys, updatedAt } = c.req.valid('json')
    const item = await putVaultItem(
      c.get('userId'),
      nameParam(c.req.param('name')),
      ciphertext,
      keys,
      updatedAt,
    )

    return c.json({ item })
  },
)

vaultRoutes.delete('/items/:name', async (c) => {
  await deleteVaultItem(c.get('userId'), nameParam(c.req.param('name')))

  return c.body(null, 204)
})
