#!/usr/bin/env node
// Protocol fixture: no model requests or real credentials.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
// A turn started with this text stays active until it is steered.
const HOLD = 'Fixture held turn'
let held = false

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line)

  if (msg.id === undefined) continue
  appendFileSync(process.env.NUPHOS_SMOKE_RECORD, `${JSON.stringify(msg)}\n`)
  let result = {}
  const model = {
    id: 'smoke-model',
    model: 'smoke-model',
    displayName: 'Smoke',
    description: 'Fixture',
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Medium' },
      { reasoningEffort: 'high', description: 'High' },
    ],
    additionalSpeedTiers: ['fast'],
    inputModalities: ['text'],
  }

  if (msg.method === 'account/read')
    result = { requiresOpenaiAuth: false, account: { type: 'apiKey' } }
  if (msg.method === 'config/read') result = { config: { model_provider: 'openai' } }
  if (msg.method === 'model/list')
    result = {
      data: [
        model,
        {
          ...model,
          id: 'smoke-second',
          model: 'smoke-second',
          displayName: 'Second',
          isDefault: false,
          additionalSpeedTiers: [],
        },
        {
          ...model,
          id: 'gpt-6-astra',
          model: 'gpt-6-astra',
          displayName: 'GPT-6-Astra',
          isDefault: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'ultra', description: 'Ultra' }],
          defaultReasoningEffort: 'ultra',
        },
      ],
      nextCursor: null,
    }
  if (msg.method === 'skills/list')
    result = { data: [{ cwd: '/workspace/conv-smoke', skills: [], errors: [] }] }
  if (msg.method === 'thread/start' || msg.method === 'thread/resume')
    result = {
      thread: { id: 'smoke-thread', turns: [] },
      model: 'smoke-model',
      reasoningEffort: 'medium',
      modelProvider: 'openai',
    }
  if (msg.method === 'thread/read') result = { thread: { id: 'smoke-thread', turns: [] } }
  if (msg.method === 'mcpServerStatus/list') result = { data: [], nextCursor: null }
  if (msg.method === 'thread/goal/get') result = { goal: null }
  if (msg.method === 'turn/start')
    result = { turn: { id: 'smoke-turn', status: 'inProgress', items: [], error: null } }
  if (msg.method === 'turn/steer') {
    // Mirrors App Server: steering never starts a turn and is fenced to the active one.
    if (!held || msg.params.expectedTurnId !== 'smoke-turn') {
      send({ id: msg.id, error: { code: -32600, message: 'no active turn to steer' } })
      continue
    }
    result = { turnId: 'smoke-turn' }
  }
  send({ id: msg.id, result })
  if (msg.method === 'turn/start' && msg.params.input.some((item) => item.text === HOLD)) {
    held = true
    continue
  }
  if (msg.method === 'turn/start' || msg.method === 'turn/steer')
    setTimeout(() => {
      held = false
      send({
        method: 'turn/completed',
        params: {
          threadId: 'smoke-thread',
          turn: { id: 'smoke-turn', status: 'completed', items: [], error: null },
        },
      })
    }, 20)
}
