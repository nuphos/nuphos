// A session ended elsewhere (signed out from another device, or expired) while the app is open:
// an agent route refuses it, and the app signs out instead of asking again and again.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Ends every sign-in of `email`, as Sign out of all devices does. */
function revokeSessions(mongoUri: string, email: string): void {
  const run = `
    import { MongoClient } from 'mongodb'
    const [uri, email] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const user = await db.collection('users').findOne({ email })
    await db.collection('user_sessions').deleteMany({ userId: user._id.toHexString() })
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, email], { cwd: BACKEND_DIR, timeout: 10_000 })
}

// Last: it signs the app out.
export const sessionRevokedScenario: Scenario = {
  name: 'a session revoked mid-use: an agent route refuses it and the app signs out',
  expected: /"status":401/,
  run: async (page, stack) => {
    revokeSessions(stack.mongoUri, stack.email)
    // What a Chats list refresh sees. Across IPC the refusal must still read as `unauthorized`,
    // the code the app signs out on; it used to arrive as a bare message. The app's own refresh
    // may get there first and sign out mid-call, which is the same outcome.
    const message = await page
      .evaluate(
        (teamId) =>
          window.api.agentListConversations(teamId).then(
            () => 'answered',
            (error: Error) => error.message,
          ),
        stack.teamId,
      )
      .catch((error: Error) => {
        if (error.message.includes('Execution context was destroyed')) return null
        throw error
      })

    if (message !== null && !message.includes('"code":"unauthorized"'))
      throw new Error(`The refused agent route did not read as unauthorized: ${message}`)
    await page.getByRole('button', { name: 'Continue with email' }).waitFor()
  },
}
