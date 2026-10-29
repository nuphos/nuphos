// Claude Code's AskUserQuestion and Codex's request_user_input reach an ACP
// client as form elicitations, which OpenAB does not render: the Claude adapter
// then disables the tool and the Codex adapter answers it with nothing, so the
// person never sees the question. Both adapters ask it through the session's own
// nuphos-tools request_user_decision instead, which registers the pending
// question Inbox and the session panel show. As with that tool, the reply comes
// back as the person's next message, so the agent is told to end its turn.
// Inlined into both adapter bundles: no imports.

export const NUPHOS_QUESTION_ASKED =
  'The question is now shown to the user in Nuphos. End your turn without choosing for them; their answer arrives as the next user message.'
export const NUPHOS_QUESTION_FAILED =
  'Nuphos could not show this question to the user. Ask it with the nuphos-tools request_user_decision tool instead.'
// A hung tools server must not hold the agent's turn.
export const NUPHOS_QUESTION_TIMEOUT_MS = 15_000

// OpenAB runs one adapter process per conversation, so the latest session's
// server is this conversation's. A load that names no servers keeps it.
let nuphosDecisionServer

function nuphosToolsServer(servers) {
  return Array.isArray(servers)
    ? servers.find(
        (entry) =>
          entry?.type === 'http' && entry.name === 'nuphos-tools' && typeof entry.url === 'string',
      )
    : undefined
}

/** Whether a session can ask through Nuphos at all. */
export function nuphosOffersDecisions(servers) {
  return Boolean(nuphosToolsServer(servers))
}

export function nuphosRememberDecisionServer(servers) {
  const server = nuphosToolsServer(servers)
  if (!server) return
  const header = (Array.isArray(server.headers) ? server.headers : []).find(
    (entry) => entry?.name?.toLowerCase() === 'authorization',
  )
  nuphosDecisionServer = { url: server.url, authorization: header?.value }
}

/** request_user_decision arguments for `questions`: [{ header?, question, options?: string[] }]. */
export function nuphosDecisionArguments(questions) {
  const [first] = questions
  const label = String(first.header || first.question).slice(0, 80)
  if (questions.length === 1) {
    const options = (first.options ?? []).slice(0, 5).map((option) => option.slice(0, 300))
    return {
      label,
      category: 'preference',
      question: first.question.slice(0, 1000),
      ...(options.length >= 2 ? { options } : {}),
    }
  }
  // The decision holds one question; several are listed in it, choices inline.
  const question = questions
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.question}${entry.options?.length ? ` (${entry.options.join(' / ')})` : ''}`,
    )
    .join('\n')
  return { label, category: 'preference', question: question.slice(0, 1000) }
}

// Where OpenAB keeps the conversation token, its file is the credential, as in
// mcp-http-bridge.mjs: a missing or empty file means OpenAB revoked it, and the
// session's (possibly stale) header is never used in its place.
async function nuphosAuthorization(server, env) {
  if (!env.OPENAB_CREDENTIALS_DIR) return server.authorization
  try {
    const { readFile } = await import('node:fs/promises')
    const token = (await readFile(`${env.OPENAB_CREDENTIALS_DIR}/NUPHOS_TOKEN`, 'utf8')).trim()
    return token ? `Bearer ${token}` : undefined
  } catch {
    return undefined
  }
}

/** Registers the questions as a pending decision; true once Nuphos accepted it. */
export async function nuphosAskInNuphos(
  questions,
  env = process.env,
  request = fetch,
  timeoutMs = NUPHOS_QUESTION_TIMEOUT_MS,
) {
  const server = nuphosDecisionServer
  if (!server || !questions.length) return false
  const authorization = await nuphosAuthorization(server, env)
  if (!authorization) return false
  try {
    const response = await request(server.url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'request_user_decision', arguments: nuphosDecisionArguments(questions) },
      }),
    })
    const body = await response.json()
    return response.ok && Boolean(body?.result) && body.result.isError !== true
  } catch {
    return false
  }
}

function nuphosQuestionText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Claude's canUseTool answer for AskUserQuestion: the tool never runs, the reason reaches Claude. */
export async function nuphosAskClaudeQuestion(toolInput, env = process.env, request = fetch) {
  const questions = (Array.isArray(toolInput?.questions) ? toolInput.questions : [])
    .map((entry) => ({
      header: nuphosQuestionText(entry?.header),
      question: nuphosQuestionText(entry?.question),
      options: (Array.isArray(entry?.options) ? entry.options : [])
        .map((option) => nuphosQuestionText(option?.label))
        .filter(Boolean),
    }))
    .filter((entry) => entry.question)
  const asked = await nuphosAskInNuphos(questions, env, request)
  return { behavior: 'deny', message: asked ? NUPHOS_QUESTION_ASKED : NUPHOS_QUESTION_FAILED }
}

/**
 * Codex's request_user_input response: every question answered with what to do
 * next. A secret is never asked this way, since the answer would arrive as a
 * chat message the model reads; request_user_decision has a secure card for it.
 */
export async function nuphosAskCodexQuestion(params, env = process.env, request = fetch) {
  const asked = (Array.isArray(params?.questions) ? params.questions : []).filter(
    (entry) => typeof entry?.id === 'string' && nuphosQuestionText(entry.question),
  )
  const secret = asked.some((entry) => entry.isSecret === true)
  const questions = asked.map((entry) => ({
    header: nuphosQuestionText(entry.header),
    question: nuphosQuestionText(entry.question),
    options: (Array.isArray(entry.options) ? entry.options : [])
      .map((option) => nuphosQuestionText(option?.label))
      .filter(Boolean),
  }))
  const reply =
    !secret && (await nuphosAskInNuphos(questions, env, request))
      ? NUPHOS_QUESTION_ASKED
      : NUPHOS_QUESTION_FAILED
  return { answers: Object.fromEntries(asked.map((entry) => [entry.id, { answers: [reply] }])) }
}
