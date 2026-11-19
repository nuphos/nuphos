// Removing a person's computer from Settings > Computers, the way its owner does.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'

export const computerRemoveScenarios: Scenario[] = [
  {
    // Removing a computer while it was online answered "Quit Nuphos on this computer first".
    name: 'an online computer is removed, told so, and does not come back',
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const label = `E2E online computer ${deviceId.slice(0, 8)}`
      const auth = { authorization: `Bearer ${stack.token}` }
      const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, label, platform: 'darwin', allowLocalExec: true }),
      })

      if (!registered.ok) throw new Error(`Registering answered ${String(registered.status)}`)
      const host = new WebSocket(
        `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
        { headers: auth } as unknown as string[],
      )
      const closed = new Promise<number>((done) =>
        host.addEventListener('close', (event) => done(event.code)),
      )

      host.addEventListener('message', (event) => {
        if (String(event.data).includes('"ping"')) host.send(JSON.stringify({ t: 'pong' }))
      })
      await new Promise((opened, failed) => {
        host.addEventListener('open', opened)
        host.addEventListener('error', failed)
      })
      host.send(JSON.stringify({ t: 'status', status: { agentInstances: true, agents: {} } }))
      await openComputers(page)
      const card = page.getByText(label, { exact: true })

      await card.first().waitFor()
      await page.getByRole('button', { name: `Manage ${label}` }).click()
      await page.getByRole('menuitem', { name: 'Remove computer' }).click()
      const dialog = page.getByRole('alertdialog')

      await dialog.getByText(`${label} is online.`, { exact: false }).waitFor()
      // The dialog fades in.
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'remove-online-computer-confirm.png') })
      await dialog.getByRole('button', { name: 'Remove computer' }).click()
      await card.first().waitFor({ state: 'detached' })
      // 4003: the backend told it the computer was removed, so it stops instead of redialing.
      const code = await closed

      if (code !== 4003) throw new Error(`The computer's tunnel closed with ${String(code)}`)
      await page.waitForTimeout(5_000)
      if (await card.count()) throw new Error('The removed computer came back')
      const left = await fetch(`${stack.apiUrl}/agent/devices?teamId=${stack.teamId}`, {
        headers: auth,
      })

      if (JSON.stringify(await left.json()).includes(deviceId))
        throw new Error('The backend still lists the removed computer')
      await page.screenshot({ path: join(artifacts, 'remove-online-computer-gone.png') })
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
]
