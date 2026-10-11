import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { conversationPrompt, listLocalAgentSessions } from './local-sessions.ts'

function userTurn(text: string) {
  return {
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  }
}

function writeCodexSession(home: string, name: string, source: unknown, prompts: string[]) {
  const dir = path.join(home, '.codex', 'sessions', '2026', '10', '11')
  const records = [
    { type: 'session_meta', payload: { cwd: '/work/app', source } },
    ...prompts.map(userTurn),
  ]

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `rollout-${name}.jsonl`),
    records.map((record) => JSON.stringify(record)).join('\n'),
  )
}

test('injected context is not what the person typed', () => {
  for (const text of [
    '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>',
    '<recommended_plugins>\nHere is a list\n</recommended_plugins>',
    '<external_codex_apps_open_page>{"page":1}</external_codex_apps_open_page>',
    '<command-name>/clear</command-name>',
    '# AGENTS.md instructions for /x',
  ]) {
    assert.equal(conversationPrompt(text), null, text)
  }
  assert.equal(
    conversationPrompt('<system-reminder>\nNo project folder.\n</system-reminder>\n\nWhat syncs?'),
    'What syncs?',
  )
  assert.equal(conversationPrompt('fix the <Button> padding'), 'fix the <Button> padding')
  assert.equal(conversationPrompt('<div> is misaligned'), '<div> is misaligned')
  assert.equal(
    conversationPrompt('<details>trace</details> explain this'),
    '<details>trace</details> explain this',
  )
})

function writeClaudeSession(home: string, name: string, sidechain: boolean, prompt: string) {
  const dir = path.join(home, '.claude', 'projects', '-work-app')
  const record = {
    type: 'user',
    isSidechain: sidechain,
    cwd: '/work/app',
    message: { role: 'user', content: prompt },
  }

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.jsonl`), JSON.stringify(record))
}

test('Codex sessions list only what a person typed into', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-sessions-'))
  const previousHome = process.env.HOME

  process.env.HOME = home
  try {
    writeCodexSession(home, 'typed', 'vscode', [
      '<recommended_plugins>\nHere is a list\n</recommended_plugins>',
      'Why does the build fail?',
    ])
    writeCodexSession(home, 'reviewer', { subagent: { other: 'guardian' } }, [
      'The following is the Codex agent history whose request action you are assessing',
    ])
    writeCodexSession(home, 'promptless', 'vscode', [
      '<environment_context>\n</environment_context>',
    ])

    const sessions = await listLocalAgentSessions('codex')

    assert.deepEqual(
      sessions.map((session) => session.title),
      ['Why does the build fail?'],
    )
  } finally {
    process.env.HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('Claude Code sub-agent transcripts are not listed', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'local-sessions-'))
  const previousHome = process.env.HOME

  process.env.HOME = home
  try {
    writeClaudeSession(home, 'typed', false, 'Rename the billing module')
    writeClaudeSession(home, 'agent-a5c6', true, 'Search the repo for billing usages')

    const sessions = await listLocalAgentSessions('claude-code')

    assert.deepEqual(
      sessions.map((session) => session.title),
      ['Rename the billing module'],
    )
  } finally {
    process.env.HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
