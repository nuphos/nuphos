import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import { readLocalSessionTranscript } from './local-session-transcript.ts'

function logFile(name: string, records: unknown[]): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'session-')), name)

  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

  return file
}

describe('readLocalSessionTranscript (claude-code)', () => {
  it('keeps the human turns, merges split answers, and drops tool + sidechain records', async () => {
    const file = logFile('a.jsonl', [
      {
        type: 'user',
        message: { role: 'user', content: '<environment_context>cwd</environment_context>' },
      },
      { type: 'user', message: { role: 'user', content: 'Why is the deploy failing?' } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Checking' }] },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'kubectl get pods' } }],
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'The image tag is wrong.' }],
        },
      },
      {
        type: 'assistant',
        isSidechain: true,
        message: { role: 'assistant', content: 'sub-agent noise' },
      },
      'not json',
    ])
    const transcript = await readLocalSessionTranscript('claude-code', file)

    assert.equal(transcript.title, 'Why is the deploy failing?')
    assert.deepEqual(
      transcript.messages.map((message) => [message.role, message.parts[0]?.text]),
      [
        ['user', 'Why is the deploy failing?'],
        ['assistant', 'Checking\n\nThe image tag is wrong.'],
      ],
    )
    assert.equal(transcript.dropped, 0)
  })

  it('prefers the session’s generated title', async () => {
    const file = logFile('b.jsonl', [
      { type: 'user', message: { role: 'user', content: 'first ask' } },
      { type: 'ai-title', aiTitle: 'Deploy triage' },
    ])

    assert.equal((await readLocalSessionTranscript('claude-code', file)).title, 'Deploy triage')
  })
})

describe('readLocalSessionTranscript (codex)', () => {
  it('reads response items and user/agent events', async () => {
    const file = logFile('rollout-2026.jsonl', [
      { type: 'session_meta', payload: { cwd: '/repo' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Scale the cluster' }],
        },
      },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Scaled to 5 nodes.' } },
    ])
    const transcript = await readLocalSessionTranscript('codex', file)

    assert.equal(transcript.title, 'Scale the cluster')
    assert.deepEqual(
      transcript.messages.map((message) => [message.role, message.parts[0]?.text]),
      [
        ['user', 'Scale the cluster'],
        ['assistant', 'Scaled to 5 nodes.'],
      ],
    )
  })

  it('falls back to the log name when nothing readable is left', async () => {
    const file = logFile('rollout-empty.jsonl', [{ type: 'session_meta', payload: {} }])
    const transcript = await readLocalSessionTranscript('codex', file)

    assert.equal(transcript.title, 'empty')
    assert.deepEqual(transcript.messages, [])
  })
})
