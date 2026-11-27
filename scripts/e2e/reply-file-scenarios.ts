// #3861: a file an agent cited in its reply, once past its 24-hour lifetime.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, openRow, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const EXPIRED = 'File expired — no longer available.'

/** A finalized transfer group holding `fileName`, as an agent's transfer-push.sh leaves it. */
async function pushed(stack: Stack, fileName: string): Promise<string> {
  const call = client(stack.apiUrl, stack.token)
  const transfers = `/teams/${stack.teamId}/file-transfers`
  const { groupId, files } = (
    await call('POST', transfers, { direction: 'download', files: [{ fileName, size: 4 }] })
  ).body as { groupId: string; files: { uploadUrl: string }[] }

  await fetch(files[0]?.uploadUrl ?? '', { method: 'PUT', body: 'test' })
  await call('POST', `${transfers}/${groupId}/finalize`, {})

  return groupId
}

// Ages both groups past their lifetime, `refused` still stored (410), `deleted` gone (404),
// and stores an agent reply citing both after the session's own messages.
function expireAndCite(stack: Stack, marker: string, refused: string, deleted: string) {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const [uri, teamId, marker, refused, deleted] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const past = new Date(Date.now() - 60_000)
    await db.collection('file_transfer_groups').updateOne({ _id: new ObjectId(refused) }, { $set: { expiresAt: past } })
    await db.collection('file_transfer_groups').deleteOne({ _id: new ObjectId(deleted) })
    const session = await db.collection('agent_conversations').findOne({ teamId, firstMessage: { $regex: marker } })
    const { sessionId, userId } = session
    const messages = db.collection('agent_messages')
    const index = await messages.countDocuments({ sessionId, userId })
    const now = new Date()
    const text = 'Here are the screenshot and the walkthrough:\\n\\n![Screenshot](https://nuphos.ai/_reply-images/' + deleted + ')\\n\\n![Walkthrough](https://nuphos.ai/_reply-images/' + refused + ')'
    await messages.insertOne({ sessionId, userId, messageId: 'reply-files', index, role: 'assistant', parts: [{ type: 'text', text }], createdAt: now, updatedAt: now })
    await db.collection('agent_conversations').updateOne({ sessionId, userId }, { $set: { messageCount: index + 1, transcriptUpdatedAt: now, lastActiveAt: now } })
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, stack.teamId, marker, refused, deleted], {
    cwd: BACKEND_DIR,
    timeout: 20_000,
  })
}

export const replyFileScenarios: Scenario[] = [
  {
    name: 'files a reply cites read as expired past their lifetime, with no Retry',
    // Both groups are refused on purpose: one expired (410), one deleted (404).
    expected:
      /"error_code":"transfer_(expired|not_found)"|"path":"\/teams\/[^"]+\/file-transfers\/[a-f0-9]{24}\/download","status":(404|410)/,
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:reply-files'

      await newTask(page)
      await send(page, `Show me the files ${marker}`)
      await page.getByText(`ACK ${marker}`).waitFor()
      const deleted = await pushed(stack, 'screenshot.png')
      const refused = await pushed(stack, 'walkthrough.mp4')

      expireAndCite(stack, marker, refused, deleted)
      // Away and back, as a person opens the conversation the next day.
      await newTask(page)
      await openRow(page, `Show me the files ${marker}`)
      const reply = page.getByText('Here are the screenshot and the walkthrough:').locator('..')

      await reply.waitFor()
      await page.waitForTimeout(1500)
      await reply.screenshot({ path: `${artifacts}/reply-files-expired.png` })
      const shown = await page.getByText(EXPIRED, { exact: true }).count()
      const retries = await reply.getByRole('button', { name: 'Retry' }).count()

      if (shown !== 2 || retries !== 0)
        throw new Error(
          `Expected 2 "${EXPIRED}" and no Retry, got ${String(shown)} and ${String(retries)}`,
        )
    },
  },
]
