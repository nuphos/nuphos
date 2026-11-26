// `bun run e2e:vault`: the Desktop app's Vault against a real backend and MongoDB
// (nuphos/nuphos#5088). Every device is treated the same: an item reaches only the
// devices picked for it, approval wraps nothing, and an item keeps at least one device.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import {
  fingerprint,
  generateDeviceKey,
  open,
  unwrap,
} from '../../apps/desktop/electron/vault/crypto.ts'

import { startDesktop } from './desktop.ts'
import { artifacts, freePorts, signInCode, spawn, stopAll, until } from './processes.ts'
import { initiateReplicaSet, startMongo } from './stack.ts'

import type { Desktop } from './desktop.ts'

type Json = Record<string, any>

const [mongoPort, backendPort] = await freePorts(2)
const mongoUri = startMongo(mongoPort!)
const apiUrl = `http://127.0.0.1:${String(backendPort)}`
const email = `vault-${String(Date.now())}@example.com`
const VALUE = 'ghp_fictional_e2e_value'
let token = ''
let desktop: Desktop | undefined
let failed = false

const call = async (method: string, path: string, body?: unknown, bearer = token) => {
  const response = await fetch(apiUrl + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  return { status: response.status, body: (await response.json().catch(() => ({}))) as Json }
}
const ok = async (method: string, path: string, body?: unknown) => {
  const { status, body: json } = await call(method, path, body)

  if (status >= 400) throw new Error(`${method} ${path} answered ${String(status)}`)

  return json
}
const check = (label: string, pass: boolean) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`)
  if (!pass) failed = true
}
const holders = async () =>
  ((await ok('GET', '/vault/items')).items as Json[]).find((i) => i.name === 'github-token')
    ?.deviceIds as string[]
/** Whether `privateKey` opens `item` to VALUE, with the one key wrapped for it. */
const opens = (item: Json, privateKey: Buffer) =>
  (item.keys as Json[]).some((k) => {
    try {
      const key = unwrap(k.wrapped as string, item.name as string, privateKey)

      return open(key, item.name as string, item.ciphertext as string).toString() === VALUE
    } catch {
      return false
    }
  })
const shot = (name: string) => desktop!.page.screenshot({ path: `${artifacts}/${name}.png` })

/** User settings, Vault; `fresh` reloads the window first, as opening the app again would. */
async function openVault(fresh = false) {
  const { page } = desktop!

  if (fresh) await page.reload()
  await page
    .getByRole('button', { name: /^Search/ })
    .first()
    .click()
  await page.getByPlaceholder(/^Search Bots/).fill('User settings')
  await page.getByRole('option', { name: 'User settings' }).first().click()
  await page.getByRole('button', { name: 'Vault', exact: true }).click()
}

try {
  console.log(`Artifacts: ${artifacts}`)
  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  spawn('backend', ['bun', 'run', 'src/index.ts'], {
    cwd: resolve(import.meta.dirname, '../../apps/backend'),
    env: {
      NODE_ENV: 'development',
      PORT: String(backendPort),
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
      MONGODB_URI: mongoUri,
      MONGODB_DB: 'nuphos_e2e_vault',
      ATLAS_REDIS_ENABLED: 'false',
      NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
      NUPHOS_LOCAL_STACK: 'true',
      NUPHOS_BACKEND_URL: apiUrl,
    },
  })
  await until('the backend to be ready', async () => (await fetch(`${apiUrl}/health/ready`)).ok)

  // The script's own session, for the checks the screen cannot show, and a team to sign in to.
  await ok('POST', '/auth/email/request-code', { email })
  await until('the sign-in code', async () => signInCode(email))
  const first = signInCode(email)

  token = (await ok('POST', '/auth/email/verify-code', { email, code: first })).token
  await ok('POST', '/teams', { name: 'Vault E2E' })

  desktop = await startDesktop(apiUrl)
  const { page } = desktop

  page.setDefaultTimeout(30_000)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.locator('input[type=email]').fill(email)
  // One code an address a minute.
  await new Promise((done) => setTimeout(done, 61_000))
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await until('a second sign-in code', async () => signInCode(email) !== first)
  await page.locator('input[placeholder="000000"]').fill(signInCode(email) ?? '')
  await openVault()
  await page.getByRole('button', { name: 'Add this computer' }).click()
  await page.getByRole('heading', { name: 'Items' }).waitFor()
  const mine = ((await ok('GET', '/vault/devices')).devices as Json[])[0]!.id as string

  // A fixed name for this computer, so the screenshots do not show the host's.
  execFileSync(
    'bun',
    [
      '-e',
      `import { MongoClient } from 'mongodb'
      const client = await new MongoClient(process.argv[1]).connect()
      await client.db('nuphos_e2e_vault').collection('vault_devices')
        .updateOne({ _id: process.argv[2] }, { $set: { name: 'This Mac (Desktop)' } })
      await client.close()`,
      mongoUri,
      mine,
    ],
    { cwd: resolve(import.meta.dirname, '../../apps/backend'), timeout: 10_000 },
  )

  // A second computer, with a key this script holds: it waits for approval.
  const studio = generateDeviceKey()
  const added = (
    await ok('POST', '/vault/devices', {
      name: 'Studio Mac',
      publicKey: studio.publicKey.toString('base64'),
    })
  ).device as Json

  check('a second device waits for approval', added.state === 'pending')

  // A new item goes to the device that saves it.
  await page.getByRole('textbox', { name: 'Name' }).fill('github-token')
  await page.getByRole('textbox', { name: 'Value' }).fill(VALUE)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved github-token').waitFor()
  check('a new item goes only to the device that saved it', (await holders()).join() === mine)

  // Approval shows the fingerprint and wraps nothing; the vault is opened again to see the device.
  await openVault(true)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  const confirm = page.getByRole('alertdialog')

  await confirm.getByText(fingerprint(studio.publicKey)).waitFor()
  await shot('1-approve-dialog')
  await confirm.getByRole('button', { name: 'Approve' }).click()
  await until('the approval', async () =>
    ((await ok('GET', '/vault/devices')).devices as Json[]).every((d) => d.state === 'enrolled'),
  )
  check('approval wraps nothing', (await holders()).join() === mine)
  await page.getByRole('textbox', { name: 'Name' }).fill('new-item')
  await page.getByText('Studio Mac').first().waitFor()
  await shot('2-new-item-defaults-to-this-device')
  await page.getByRole('textbox', { name: 'Name' }).fill('')

  // Shared with the Studio Mac from the item's row, saved on the tick; its key opens the value there.
  const sharedWith = (name: string) =>
    page
      .getByText(name, { exact: true })
      .locator('xpath=ancestor::div[.//button[@aria-label="Shared with"]][1]')
      .getByRole('button', { name: 'Shared with' })
  const picker = page.getByRole('dialog', { name: 'Computers' })

  await sharedWith('github-token').click()
  await picker.getByRole('checkbox', { name: 'Studio Mac' }).click()
  await until('the share', async () => (await holders()).length === 2)
  await picker.getByText('2 of 2 selected').waitFor()
  await shot('3-share-with-another-device')
  const item = (await ok('GET', '/vault/items/github-token')).item as Json

  check('the device it is shared with opens it with its own key', opens(item, studio.privateKey))

  // Removing one warns that it may have kept the value, and the last one cannot be removed.
  await picker.getByRole('checkbox', { name: 'This Mac (Desktop)' }).click()
  await until('the unshare', async () => (await holders()).join() === added.id)
  await picker.getByText('may have kept the value it already read').waitFor()
  await shot('4-unshare-warning-and-last-computer')
  check('an item may be shared with another computer alone', (await holders()).join() === added.id)
  const last = picker.getByRole('checkbox', { name: 'Studio Mac' })

  check('the last computer cannot be unticked', await last.isDisabled())
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'hidden' })

  // Its only device stays.
  await page.getByRole('button', { name: 'Remove', exact: true }).nth(1).click()
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await page.getByText('Could not update the device').first().waitFor()
  await confirm.waitFor({ state: 'hidden' })
  await shot('6-only-device-stays')
  check(
    'the only device an item is shared with cannot be removed',
    (await call('DELETE', `/vault/devices/${String(added.id)}`)).status === 409,
  )

  // An older client's write, without the read it is based on.
  const { ciphertext, keys } = item

  check(
    'a write that names no earlier read is refused',
    (await call('PUT', '/vault/items/github-token', { ciphertext, keys })).status === 400,
  )

  // A computer joined with a device credential reads an item only once it is shared with it.
  const label = 'Build box'
  const { token: joinToken } = await ok('POST', '/agent/devices/join-tokens', { label })
  const joined = await ok('POST', '/auth/devices/join', {
    token: joinToken,
    label,
    platform: 'linux',
  })
  const build = generateDeviceKey()
  const asBox = (method: string, path: string, body?: unknown) =>
    call(method, path, body, String(joined.credential))
  const publicKey = build.publicKey.toString('base64')
  const box = (await asBox('POST', '/vault/computer/devices', { publicKey })).body.device as Json

  // An older client sends keys with an approval; they are ignored.
  await ok('POST', `/vault/devices/${String(box.id)}/approve`, {
    keys: [{ name: 'github-token', wrapped: (keys as Json[])[0]!.wrapped }],
  })
  check('keys sent with an approval are ignored', (await holders()).join() === added.id)
  const read = () => asBox('GET', `/vault/computer/items/deploy-key?user=${String(joined.userId)}`)

  await openVault(true)
  await page.getByRole('textbox', { name: 'Name' }).fill('deploy-key')
  await page.getByRole('textbox', { name: 'Value' }).fill(VALUE)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved deploy-key').waitFor()
  check('a computer cannot read an item not shared with it', (await read()).status === 404)
  await sharedWith('deploy-key').click()
  await picker.getByRole('checkbox', { name: 'Build box' }).click()
  await until('the share', async () => (await read()).status === 200)
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'hidden' })
  check(
    'a computer reads an item shared with it, with its own key',
    opens((await read()).body.item as Json, build.privateKey),
  )

  // A share chosen from an older read is refused, and the list stays open to say so.
  await sharedWith('deploy-key').click()
  const current = (await ok('GET', '/vault/items/deploy-key')).item as Json

  await ok('PUT', '/vault/items/deploy-key', {
    ciphertext: current.ciphertext,
    keys: current.keys,
    updatedAt: current.updatedAt,
  })
  await picker.getByRole('checkbox', { name: 'Build box' }).click()
  await picker.getByText('The item changed since it was read').waitFor()
  await shot('7-stale-share-refused')
  check('a share based on an older read is refused', (await read()).status === 200)

  // Read again: a waiting computer cannot be picked, the list filters, and the unshare goes through.
  const pendingKey = generateDeviceKey().publicKey.toString('base64')

  await ok('POST', '/vault/devices', { name: 'Office iMac', publicKey: pendingKey })
  await openVault(true)
  await sharedWith('deploy-key').click()
  const waiting = picker.getByRole('checkbox', { name: 'Office iMac' })

  check('a computer waiting for approval cannot be picked', await waiting.isDisabled())
  await shot('8-pending-row')
  await picker.getByRole('textbox', { name: 'Search computers' }).fill('box')
  await shot('9-search')

  await picker.getByRole('checkbox', { name: 'Build box' }).click()
  await until('the unshare', async () => (await read()).status === 404)
  check('a computer cannot read an item after it is unshared', (await read()).status === 404)
} catch (error) {
  failed = true
  console.error(error)
  await desktop?.page.screenshot({ path: `${artifacts}/vault-failed.png` }).catch(() => {})
} finally {
  await desktop?.close(failed)
  await stopAll()
}
console.log(failed ? `FAIL: see ${artifacts}` : 'PASS the vault flow')
process.exit(failed ? 1 : 0)
