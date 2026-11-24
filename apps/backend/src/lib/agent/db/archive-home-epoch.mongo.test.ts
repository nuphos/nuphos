import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { closeDb, connectDb } from '@/lib/db'

import { setConversationArchived } from './archive'
import { agentConversations } from './shared'

const by = { source: 'user', userId: 'u' } as const

const owner = randomUUID()
const team = randomUUID()
const sessionId = randomUUID()
const program = `
  import { connectDb, closeDb } from './src/lib/db.ts'
  import { restoreArchivedConversation } from './src/lib/agent/db/archive.ts'
  await connectDb()
  const result = await restoreArchivedConversation(process.argv[1], { source: 'turn' })
  console.log(JSON.stringify({ restored: result }))
  await closeDb()
`

describe.skipIf(!process.env.TEST_MONGODB_URI)(
  'restoring home epoch across backend replicas',
  () => {
    beforeAll(async () => {
      await connectDb()
      const now = new Date()

      await agentConversations().insertOne({
        sessionId,
        userId: owner,
        teamId: team,
        title: 'Fixture',
        firstMessage: '',
        messageCount: 0,
        createdAt: now,
        lastActiveAt: now,
        archivedAt: now,
        sessionHomeEpoch: 0,
      })
    })
    afterAll(async () => {
      await agentConversations().deleteMany({ teamId: team })
      await closeDb()
    })
    test('repeated archive and restore retain each pending generation while offline', async () => {
      const other = randomUUID()
      const now = new Date()

      await agentConversations().insertOne({
        sessionId: other,
        userId: owner,
        teamId: team,
        title: 'Offline fixture',
        firstMessage: '',
        messageCount: 0,
        createdAt: now,
        lastActiveAt: now,
      })
      await setConversationArchived(other, true, by)
      await setConversationArchived(other, false, by)
      await setConversationArchived(other, true, by)
      await setConversationArchived(other, false, by)
      const row = await agentConversations().findOne({ sessionId: other })

      expect(row?.sessionHomeEpoch).toBe(2)
      expect(row?.archiveHomePendingEpochs?.map((home) => home.epoch).sort()).toEqual([0, 1])
    })
    test('two independent processes restoring the same archive advance the generation once', async () => {
      const children = [0, 1].map(() =>
        Bun.spawn([process.execPath, '-e', program, sessionId], {
          cwd: process.cwd(),
          env: process.env,
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      )
      const results = await Promise.all(
        children.map(async (child) => ({
          output: await new Response(child.stdout).text(),
          error: await new Response(child.stderr).text(),
          code: await child.exited,
        })),
      )

      expect(results.map((r) => r.code)).toEqual([0, 0])
      expect(
        results
          .map((r) => JSON.parse(r.output.trim()).restored)
          .sort((a: boolean, b: boolean) => Number(a) - Number(b)),
      ).toEqual([false, true])
      const row = await agentConversations().findOne({ sessionId })

      expect(row?.archivedAt).toBeUndefined()
      expect(row?.sessionHomeEpoch).toBe(1)
    })
  },
)
