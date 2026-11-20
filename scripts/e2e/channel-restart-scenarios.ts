// A Bot whose agent host restarts while it answers a post in its chat (#4061).
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { inDatabase } from './agent-sign-in-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

export const channelRestartScenarios: Scenario[] = [
  {
    // The cut-off wake wrote a "runtime restarted" couldn't-reply line and left its post read,
    // so the Bot was never asked again.
    name: 'a Bot whose agent host restarts mid-answer answers once back, with no couldn’t-reply line',
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail ?? ''
      const release = join(artifacts, 'release')
      const woken = () => agentLog(stack).filter((entry) => entry.event === 'channel').length
      // The chat's couldn't-reply lines written after `since`.
      const linesAfter = (since: string): string[] =>
        JSON.parse(
          inDatabase(
            stack.mongoUri,
            `const row = await db.collection('agent_conversations').findOne({ sessionId: process.argv[2] })
            console.log(JSON.stringify((row?.timelineEvents ?? []).filter((e) => e.kind === 'agent_reply_failed' && e.at.toISOString() > process.argv[3]).map((e) => e.reason ?? '')))`,
            channelId,
            since,
          ),
        )

      rmSync(release, { force: true })
      const since = new Date().toISOString()
      const before = woken()
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            teamId: stack.teamId,
            text: 'Hold on E2E_DELIVERY:hold-restarted',
          }),
        },
      )

      if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      // The Bot is answering, and waits: its host restarts under that turn.
      await until('the Bot to start answering', async () => woken() > before, 60_000)
      await stack.restartAgentHost()
      // Left in place afterwards: a later turn that shows this post again holds nothing.
      writeFileSync(release, '')
      const answered = await page
        .getByText('POSTED E2E_DELIVERY:hold-restarted', { exact: true })
        .first()
        .waitFor({ timeout: 150_000 })
        .then(
          () => true,
          () => false,
        )

      // Pictured either way, at the newest of the post, its answer or a couldn't-reply line.
      await page
        .getByText(/E2E_DELIVERY:hold-restarted|couldn’t reply/)
        .last()
        .scrollIntoViewIfNeeded()
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/bot-restart-answered-light.png` })
      if (!answered) throw new Error('The Bot did not answer the post once its host was back')
      const lines = linesAfter(since)

      if (lines.length > 0)
        throw new Error(`The chat said the Bot could not reply: ${lines.join(' | ')}`)
    },
  },
]
