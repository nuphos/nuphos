// #4289: the media viewer's top-right Download saves the image it shows.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { client } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const IMAGE = resolve(import.meta.dirname, '../../apps/ios/tests/fixtures/media/wide.png')

/** A finalized transfer group holding `bytes`, as an agent's transfer-push.sh leaves it. */
async function pushed(stack: Stack, fileName: string, bytes: Buffer): Promise<string> {
  const call = client(stack.apiUrl, stack.token)
  const transfers = `/teams/${stack.teamId}/file-transfers`
  const { groupId, files } = (
    await call('POST', transfers, {
      direction: 'download',
      files: [{ fileName, size: bytes.length, contentType: 'image/png' }],
    })
  ).body as { groupId: string; files: { uploadUrl: string }[] }

  await fetch(files[0]?.uploadUrl ?? '', { method: 'PUT', body: new Uint8Array(bytes) })
  await call('POST', `${transfers}/${groupId}/finalize`, {})

  return groupId
}

// Stores an agent reply showing the group's image after the session's own messages.
function cite(stack: Stack, marker: string, groupId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId, marker, groupId] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const session = await db.collection('agent_conversations').findOne({ teamId, firstMessage: { $regex: marker } })
    const { sessionId, userId } = session
    const messages = db.collection('agent_messages')
    const index = await messages.countDocuments({ sessionId, userId })
    const now = new Date()
    const text = 'Here is the test pattern:\\n\\n![Test pattern](https://nuphos.ai/_reply-images/' + groupId + ')'
    await messages.insertOne({ sessionId, userId, messageId: 'viewer-image', index, role: 'assistant', parts: [{ type: 'text', text }], createdAt: now, updatedAt: now })
    await db.collection('agent_conversations').updateOne({ sessionId, userId }, { $set: { messageCount: index + 1, transcriptUpdatedAt: now, lastActiveAt: now } })
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId, marker, groupId], {
    cwd: BACKEND_DIR,
    timeout: 20_000,
  })
}

export const mediaViewerScenarios: Scenario[] = [
  {
    name: "the media viewer's top-right Download saves the image it shows, under its own name",
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:viewer-download'
      const fileName = 'test-pattern.png'
      const bytes = readFileSync(IMAGE)
      const saved = join(artifacts, 'saved', fileName)

      await newTask(page)
      await send(page, `Show image ${marker}`)
      await page.getByText(`ACK ${marker}`).waitFor()
      cite(stack, marker, await pushed(stack, fileName, bytes))
      // Away and back, so the conversation loads the stored reply.
      await newTask(page)
      await page
        .getByText(`Show image ${marker}`, { exact: true })
        .first()
        .click({ position: { x: 8, y: 8 } })
      await page.getByRole('button', { name: 'Preview Test pattern' }).click()
      const viewer = page.getByRole('dialog', { name: fileName })
      const close = viewer.getByRole('button', { name: 'Close preview' })

      await close.waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${artifacts}/media-viewer-light.png` })
      const corner = await close.boundingBox()

      if (!corner) throw new Error('The viewer has no close button on screen')
      await page.screenshot({
        path: `${artifacts}/media-viewer-corner-light.png`,
        clip: { x: corner.x + corner.width - 200, y: corner.y - 16, width: 216, height: 60 },
      })
      mkdirSync(join(artifacts, 'saved'), { recursive: true })
      rmSync(saved, { force: true })
      await viewer.locator('button[title="Download"]').click()
      await until('the shown image saved under its name', async () =>
        existsSync(saved) ? readFileSync(saved).equals(bytes) : false,
      )
      // Closed again, so the viewer doesn't cover the page for the next scenario.
      await close.click()
      await viewer.waitFor({ state: 'detached' })
    },
  },
]
