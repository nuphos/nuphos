// The team's hourly file-transfer limit, as the agent meets it through local_upload.
// Listed in computerScenarios, after the scenarios whose transfers have to go through.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const HOUR_MS = 60 * 60 * 1000
// TRANSFER_GROUPS_PER_HOUR in apps/backend/src/lib/file-transfer/admission.ts. It is a
// constant, so the suite reaches it by filling the hour's counter in its own database.
const GROUPS_PER_HOUR = 60

/** Fills the team's counters for these hours, or puts back what a fill printed.
 * Prints the counters as they were. */
function counters(stack: Stack, mode: 'fill' | 'restore', hours: number[], saved = '[]') {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, teamId, mode, hours, saved, limit] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const admissions = client.db('nuphos_e2e').collection('file_transfer_admissions')
    const before = []
    for (const hour of JSON.parse(hours)) {
      const _id = teamId + ':' + hour
      before.push({ _id, doc: await admissions.findOne({ _id }) })
      if (mode === 'fill')
        await admissions.updateOne(
          { _id },
          { $set: { count: Number(limit) }, $setOnInsert: { bytes: 0, expiresAt: new Date((hour + 2) * ${String(HOUR_MS)}) } },
          { upsert: true },
        )
    }
    if (mode === 'restore')
      for (const { _id, doc } of JSON.parse(saved))
        if (doc) await admissions.replaceOne({ _id }, { ...doc, expiresAt: new Date(doc.expiresAt) })
        else await admissions.deleteOne({ _id })
    await client.close()
    console.log(JSON.stringify(before))`

  return execFileSync(
    'bun',
    [
      '-e',
      script,
      stack.mongoUri,
      stack.teamId,
      mode,
      JSON.stringify(hours),
      saved,
      String(GROUPS_PER_HOUR),
    ],
    { cwd: BACKEND_DIR, timeout: 10_000 },
  )
    .toString()
    .trim()
}

export const transferLimitScenarios: Scenario[] = [
  {
    name: 'a rate-limited upload returns the reset time and the agent is told not to retry',
    run: async (page, stack) => {
      const path = join(artifacts, 'over-the-limit.txt')
      const hour = Math.floor(Date.now() / HOUR_MS)
      // The next hour too, in case the hour turns while the agent is on its way.
      const saved = counters(stack, 'fill', [hour, hour + 1])

      try {
        writeFileSync(path, 'one transfer too many')
        await newTask(page)
        const args = JSON.stringify({ label: 'Upload the file', path })

        await send(page, `Bring it in E2E_CALL local_upload ${args} E2E_DELIVERY:limited`)
        await page.getByText('ACK E2E_DELIVERY:limited').waitFor()
        const answer = JSON.stringify(
          agentLog(stack).findLast((entry) => entry.event === 'called')?.result,
        )
        const resets = [hour + 1, hour + 2].map((h) => new Date(h * HOUR_MS).toISOString())

        if (!answer.includes('file_transfer_rate_limited'))
          throw new Error(`local_upload was not refused for the limit: ${answer}`)
        if (!answer.includes('retryAfter') || !resets.some((time) => answer.includes(time)))
          throw new Error(`The answer does not say when the limit resets: ${answer}`)
        if (!answer.includes('Do not retry'))
          throw new Error(`The agent is not told to stop retrying: ${answer}`)
        if (answer.includes('signed')) throw new Error(`A signed URL reached the agent: ${answer}`)
      } finally {
        counters(stack, 'restore', [], saved)
      }
    },
  },
]
