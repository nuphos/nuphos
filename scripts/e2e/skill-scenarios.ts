// #4140: an agent conversation removes a team skill it no longer needs, through the same
// `nuphos-tools` server that lets it create one, under the Skills page's role rule.
import { randomUUID } from 'node:crypto'

import { agentLog } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Call = [name: string, args: object]

/** One turn whose agent makes `calls` in order; returns each call's answer as text. */
async function callAll(stack: Stack, calls: Call[]): Promise<string[]> {
  const lines = calls.map(
    ([name, args]) => `E2E_CALL ${name} ${JSON.stringify({ label: 'Call it', ...args })}`,
  )
  const text = `Call them\n${lines.join('\n')}\nE2E_DELIVERY:${randomUUID()}`
  const from = agentLog(stack).length
  let answers: string[] = []

  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      teamId: stack.teamId,
      permissionMode: 'bypass',
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  })
    .then(async (response) => response.text())
    .catch(() => undefined)
  await until('every call to answer', async () => {
    answers = agentLog(stack)
      .slice(from)
      .filter((item) => item.event === 'called')
      .map((item) => JSON.stringify(item.result))

    return answers.length === calls.length
  })

  return answers
}

export const skillScenarios: Scenario[] = [
  {
    name: 'an agent conversation creates a throwaway team skill and deletes it',
    run: async (_page, stack) => {
      const name = `e2e-throwaway-${randomUUID().slice(0, 8)}`
      const [created, deleted, again] = await callAll(stack, [
        ['skill_create', { name, description: 'Delete me', body: '# Throwaway' }],
        ['skill_delete', { name }],
        ['skill_delete', { name }],
      ])

      must(created?.includes('\\"ok\\":true') === true, `skill_create to succeed, got ${created}`)
      must(
        deleted?.includes('\\"deletedCount\\":1') === true,
        `skill_delete to remove the skill, got ${deleted}`,
      )
      must(
        again?.includes('skill_not_found') === true,
        `a second delete to find nothing, got ${again}`,
      )
      const response = await fetch(`${stack.apiUrl}/teams/${stack.teamId}/skills/manifest`, {
        headers: { authorization: `Bearer ${stack.token}` },
      })
      const manifest = (await response.json()) as { skills: { name: string }[] }

      must(
        !manifest.skills.some((skill) => skill.name === name),
        `the Skills page to no longer list ${name}, got ${JSON.stringify(manifest.skills)}`,
      )
    },
  },
]
