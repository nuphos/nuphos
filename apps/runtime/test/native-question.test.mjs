import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { patchClaudeAskUserQuestion } from '../image/claude-agent-acp/ask-user-question.mjs'
import {
  NUPHOS_QUESTION_ASKED,
  NUPHOS_QUESTION_FAILED,
  nuphosAskClaudeQuestion,
  nuphosAskCodexQuestion,
  nuphosDecisionArguments,
  nuphosRememberDecisionServer,
} from '../image/native-question.mjs'

const servers = [
  { name: 'nuphos-credentials', type: 'http', url: 'https://api.test/mcp', headers: [] },
  {
    name: 'nuphos-tools',
    type: 'http',
    url: 'https://api.test/mcp-tools',
    headers: [{ name: 'Authorization', value: 'Bearer from-session' }],
  },
]

function recorder(result = { content: [] }, ok = true) {
  const calls = []
  const request = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return { ok, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }
  }
  return { calls, request }
}

test('AskUserQuestion registers a decision and tells Claude to end the turn', async () => {
  nuphosRememberDecisionServer(servers)
  const { calls, request } = recorder()
  const answer = await nuphosAskClaudeQuestion(
    {
      questions: [
        {
          header: 'Region',
          question: 'Which region?',
          options: [{ label: 'us-east-1' }, { label: 'eu-west-1', description: 'EU' }],
          multiSelect: false,
        },
      ],
    },
    {},
    request,
  )

  assert.deepEqual(answer, { behavior: 'deny', message: NUPHOS_QUESTION_ASKED })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.test/mcp-tools')
  assert.equal(calls[0].headers.authorization, 'Bearer from-session')
  assert.deepEqual(calls[0].body.params, {
    name: 'request_user_decision',
    arguments: {
      label: 'Region',
      category: 'preference',
      question: 'Which region?',
      options: ['us-east-1', 'eu-west-1'],
    },
  })
})

test('the current credential file wins over the session header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-question-'))
  try {
    writeFileSync(join(dir, 'NUPHOS_TOKEN'), 'rotated\n')
    nuphosRememberDecisionServer(servers)
    const { calls, request } = recorder()

    await nuphosAskClaudeQuestion(
      { questions: [{ question: 'Proceed?' }] },
      { OPENAB_CREDENTIALS_DIR: dir },
      request,
    )
    assert.equal(calls[0].headers.authorization, 'Bearer rotated')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed registration tells the agent to ask with request_user_decision', async () => {
  nuphosRememberDecisionServer(servers)
  for (const { request } of [
    recorder({ isError: true, content: [] }),
    recorder(undefined, false),
    { request: async () => Promise.reject(new Error('offline')) },
  ]) {
    const answer = await nuphosAskClaudeQuestion(
      { questions: [{ question: 'Proceed?' }] },
      {},
      request,
    )

    assert.equal(answer.message, NUPHOS_QUESTION_FAILED)
  }
  const { calls, request } = recorder()
  const empty = await nuphosAskClaudeQuestion({ questions: [] }, {}, request)

  assert.equal(empty.message, NUPHOS_QUESTION_FAILED)
  assert.equal(calls.length, 0)
})

test('a load without servers keeps the conversation server', async () => {
  nuphosRememberDecisionServer(servers)
  nuphosRememberDecisionServer(undefined)
  nuphosRememberDecisionServer([])
  const { calls, request } = recorder()

  await nuphosAskClaudeQuestion({ questions: [{ question: 'Proceed?' }] }, {}, request)
  assert.equal(calls[0].url, 'https://api.test/mcp-tools')
})

test('request_user_input answers every question with the next step', async () => {
  nuphosRememberDecisionServer(servers)
  const { calls, request } = recorder()
  const response = await nuphosAskCodexQuestion(
    {
      questions: [
        {
          id: 'db',
          header: 'Database',
          question: 'Which database?',
          options: [{ label: 'Postgres' }, { label: 'MySQL' }],
        },
        { id: 'name', header: 'Name', question: 'Project name?', options: null },
      ],
    },
    {},
    request,
  )

  assert.deepEqual(response, {
    answers: {
      db: { answers: [NUPHOS_QUESTION_ASKED] },
      name: { answers: [NUPHOS_QUESTION_ASKED] },
    },
  })
  assert.deepEqual(calls[0].body.params.arguments, {
    label: 'Database',
    category: 'preference',
    question: '1. Which database? (Postgres / MySQL)\n2. Project name?',
  })
})

test('decision arguments stay within request_user_decision limits', () => {
  const args = nuphosDecisionArguments([
    {
      question: 'q'.repeat(2000),
      options: ['a', 'b', 'c', 'd', 'e', 'f'].map((o) => o.repeat(400)),
    },
  ])

  assert.equal(args.question.length, 1000)
  assert.equal(args.label.length, 80)
  assert.equal(args.options.length, 5)
  assert.ok(args.options.every((option) => option.length === 300))
  assert.equal(
    nuphosDecisionArguments([{ question: 'Only one?', options: ['yes'] }]).options,
    undefined,
  )
})

test('the Claude patch keeps AskUserQuestion and asks through Nuphos', () => {
  const source = [
    '        const mcpServers = {};',
    '        const disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"];',
    '            if (toolName === "AskUserQuestion" && this.clientCapabilities?.elicitation?.form) {',
    '',
  ].join('\n')
  const patched = patchClaudeAskUserQuestion(source)

  assert.match(
    patched,
    /const mcpServers = \{\};\n {8}nuphosRememberDecisionServer\(params\.mcpServers\);/,
  )
  assert.match(patched, /const disallowedTools = \[\];/)
  assert.match(
    patched,
    /!this\.clientCapabilities\?\.elicitation\?\.form\) \{\n.*ensureToolCallEmitted.*\n {16}return nuphosAskClaudeQuestion\(toolInput\);\n {12}\}\n {12}if \(toolName === "AskUserQuestion" && this\.clientCapabilities/,
  )
  assert.throws(() => patchClaudeAskUserQuestion('nothing to patch'))
})
