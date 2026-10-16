import assert from 'node:assert/strict'
import { test } from 'node:test'

import { triggerCardInfo, untilRun } from './triggerCards.ts'

import type { ToolPart } from './parts.ts'

const ID = '6a2b2443f75c7dd625df8cbd'
const call = (command: string, output?: unknown, toolName = 'Terminal'): ToolPart => ({
  type: 'tool',
  toolCallId: 'c',
  toolName,
  state: 'output-available',
  input: { command },
  output,
})
const created = JSON.stringify({ id: ID, name: 'Digest', triggerType: 'cron' }, null, 2)

test('a create through the triggers script shows the new trigger', () => {
  const command = `bash skills/triggers/scripts/trigger-api.sh "$TEAM" POST '' @/tmp/trigger.json`

  assert.deepEqual(triggerCardInfo(call(command, created)), { triggerId: ID, action: 'created' })
  assert.deepEqual(triggerCardInfo(call(command, { stdout: created })), {
    triggerId: ID,
    action: 'created',
  })
})

test('an update falls back to the id in the command when no output was stored', () => {
  const command = `SCRIPT=skills/triggers/scripts/trigger-api.sh; bash "$SCRIPT" t PATCH ${ID} @/tmp/p.json`

  assert.deepEqual(triggerCardInfo(call(command)), { triggerId: ID, action: 'updated' })
})

test('webhooks, sub-routes, reads and other commands are not trigger cards', () => {
  const script = 'bash skills/triggers/scripts/trigger-api.sh t'
  const webhook = JSON.stringify({ id: ID, triggerType: 'webhook' })

  assert.equal(triggerCardInfo(call(`${script} POST '' @b.json`, webhook)), null)
  assert.equal(triggerCardInfo(call(`${script} POST ${ID}/test-fire @p.json`, created)), null)
  assert.equal(triggerCardInfo(call(`${script} GET`, created)), null)
  assert.equal(triggerCardInfo(call('echo trigger-api.sh', created)), null)
  assert.equal(triggerCardInfo(call(`${script} POST '' @b.json`, created, 'Read')), null)
})

test('bound trigger tools are read from their output', () => {
  const part = { ...call('', created, 'mcp__nuphos__trigger_update'), input: {} }

  assert.deepEqual(triggerCardInfo(part), { triggerId: ID, action: 'updated' })
})

test('untilRun counts hours up close and calendar days further out', () => {
  const now = new Date(2026, 9, 14, 16, 0)

  assert.equal(untilRun(new Date(2026, 9, 14, 16, 25), now), 'in 25 min')
  assert.equal(untilRun(new Date(2026, 9, 14, 19, 0), now), 'in 3 h')
  assert.equal(untilRun(new Date(2026, 9, 15, 9, 0), now), 'tomorrow')
  assert.equal(untilRun(new Date(2026, 9, 16, 9, 0), now), 'in 2 days')
  assert.equal(untilRun(new Date(2026, 9, 14, 20, 0), new Date(2026, 9, 14, 0, 0)), 'later today')
})

test('the Nuphos local_exec tool counts, and other tools never read their output', () => {
  const command = `bash skills/triggers/scripts/trigger-api.sh "$TEAM" POST '' @/tmp/trigger.json`
  const output = {
    toJSON() {
      throw new Error('read the output of a tool that cannot be a trigger')
    },
  }

  assert.deepEqual(triggerCardInfo(call(command, created, 'mcp__nuphos-tools__local_exec')), {
    triggerId: ID,
    action: 'created',
  })
  assert.equal(triggerCardInfo(call(command, output, 'Read')), null)
})
