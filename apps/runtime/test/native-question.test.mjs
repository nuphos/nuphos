import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { patchClaudeAskUserQuestion } from '../image/claude-agent-acp/ask-user-question.mjs'
import { patchCodexUserInput } from '../image/codex-acp/ask-user-input.mjs'
import {
  NUPHOS_QUESTION_ASKED,
  NUPHOS_QUESTION_FAILED,
  nuphosAskClaudeQuestion,
  nuphosAskCodexQuestion,
  nuphosAskInNuphos,
  nuphosDecisionArguments,
  nuphosOffersDecisions,
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
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal })
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
  assert.match(
    patched,
    /const disallowedTools = elicitationSupport\.form \|\| nuphosOffersDecisions\(params\.mcpServers\) \? \[\] : \["AskUserQuestion"\];/,
  )
  assert.match(
    patched,
    /!this\.clientCapabilities\?\.elicitation\?\.form\) \{\n.*ensureToolCallEmitted.*\n {16}return nuphosAskClaudeQuestion\(toolInput\);\n {12}\}\n {12}if \(toolName === "AskUserQuestion" && this\.clientCapabilities/,
  )
  assert.throws(() => patchClaudeAskUserQuestion('nothing to patch'))
})

test('AskUserQuestion stays off for a session that cannot ask through Nuphos', () => {
  assert.equal(nuphosOffersDecisions(servers), true)
  assert.equal(nuphosOffersDecisions([servers[0]]), false)
  assert.equal(nuphosOffersDecisions(undefined), false)
})

test('a secret question is never asked in chat, so its answer cannot reach the model', async () => {
  nuphosRememberDecisionServer(servers)
  const { calls, request } = recorder()
  const response = await nuphosAskCodexQuestion(
    {
      questions: [
        { id: 'token', header: 'Token', question: 'Paste your API token', isSecret: true },
        { id: 'region', header: 'Region', question: 'Which region?' },
      ],
    },
    {},
    request,
  )

  assert.equal(calls.length, 0)
  assert.deepEqual(response, {
    answers: {
      token: { answers: [NUPHOS_QUESTION_FAILED] },
      region: { answers: [NUPHOS_QUESTION_FAILED] },
    },
  })
})

test('a hung tools server times out instead of holding the turn', async () => {
  nuphosRememberDecisionServer(servers)
  const { calls, request: recorded } = recorder()

  await nuphosAskInNuphos([{ question: 'Proceed?' }], {}, recorded)
  assert.ok(calls[0].signal instanceof AbortSignal, 'every request carries a timeout signal')
  const hung = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
    })
  const started = Date.now()

  assert.equal(await nuphosAskInNuphos([{ question: 'Proceed?' }], {}, hung, 20), false)
  assert.ok(Date.now() - started < 5_000)
})

test('a revoked credential file fails the question instead of using the session header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-question-'))
  try {
    nuphosRememberDecisionServer(servers)
    const { calls, request } = recorder()
    const missing = await nuphosAskClaudeQuestion(
      { questions: [{ question: 'Proceed?' }] },
      { OPENAB_CREDENTIALS_DIR: dir },
      request,
    )

    writeFileSync(join(dir, 'NUPHOS_TOKEN'), '\n')
    const empty = await nuphosAskClaudeQuestion(
      { questions: [{ question: 'Proceed?' }] },
      { OPENAB_CREDENTIALS_DIR: dir },
      request,
    )

    assert.equal(missing.message, NUPHOS_QUESTION_FAILED)
    assert.equal(empty.message, NUPHOS_QUESTION_FAILED)
    assert.equal(calls.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Codex patch asks through Nuphos at both server handoffs and the user input call', () => {
  const servers = '    const requestedMcpServers = request.mcpServers ?? [];'
  const userInput = [
    '  async handleUserInput(params) {',
    '    if (!clientSupportsFormElicitation(this.clientCapabilities)) {',
    '      return { answers: {} };',
    '    }',
  ].join('\n')
  const source = [servers, 'newSession();', servers, 'loadSession();', userInput, ''].join('\n')
  const patched = patchCodexUserInput(source)

  assert.equal(patched.split('nuphosRememberDecisionServer(request.mcpServers);').length, 3)
  assert.match(patched, /return await nuphosAskCodexQuestion\(params\);/)
  assert.doesNotMatch(patched, /return \{ answers: \{\} \};/)
  // An anchor that moved, vanished or appears more often fails the build.
  assert.throws(() => patchCodexUserInput([servers, userInput].join('\n')))
  assert.throws(() => patchCodexUserInput([servers, servers, userInput, userInput].join('\n')))
  assert.throws(() => patchCodexUserInput('nothing to patch'))
})
