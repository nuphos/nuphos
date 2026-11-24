// How an agent's refusal reads: its adapter error, its notice, and whether it is out of usage.
// No imports, so logging can classify a refusal without importing the backend's errors.

/** The adapter's own JSON-RPC error, relayed by the gateway in `error.data` under -32603. */
export type AcpAdapterError = { code: number; message: string }

export class OpenAbRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly adapter?: AcpAdapterError,
  ) {
    super(message)
    this.name = 'OpenAbRpcError'
  }
}

/**
 * ACP assigns -32000 to `auth_required`: the agent holds no provider credential it
 * can bill, so a sign-in unblocks the turn and a retry never does. There is no
 * cheaper pre-flight — the agent CLI re-reads its own credential store, so a
 * session that was signed in a minute ago can raise this on the next turn.
 */
const ACP_AUTH_REQUIRED_CODE = -32000
/**
 * The prefix `RequestError.authRequired()` always carries, with or without an
 * adapter's own suffix. The code alone does not prove auth: JSON-RPC reserves
 * -32000..-32099 for implementation-defined server errors, and openab already
 * spends neighbours in that range on other conditions (-32003 key rejected,
 * -32004 dormant, -32005 busy). Requiring both fails closed — an adapter that
 * reuses -32000 for something else keeps its diagnostics instead of being
 * mislabelled as a sign-out.
 */
const ACP_AUTH_REQUIRED_MESSAGE = 'Authentication required'

/** Product code every client keys on to render sign-in guidance. */
export const RUNTIME_AUTH_REQUIRED_CODE = 'runtime_auth_required'
export const RUNTIME_AUTH_REQUIRED_MESSAGE =
  'This agent’s sign-in is no longer valid, so it could not start the turn. Sign it in again, ask its owner to, or switch to another runtime, then resend your message.'

// Runtimes before v0.1.50 send the adapter's error only in openab-core's display wrapper,
// `**<Label>** (code: N)\n<message>`. Delete this fallback once they are unsupported.
const ACP_WRAPPED = /^\*\*[^*\n]+\*\* \(code: (-?\d+)\)\n([\s\S]*)/u

/** The adapter's own error behind the gateway's -32603, from runtime v0.1.50 on its `data`. */
function adapterError(error: OpenAbRpcError): AcpAdapterError | undefined {
  if (error.code !== -32603) return undefined
  if (error.adapter) return error.adapter
  const wrapped = ACP_WRAPPED.exec(error.message)

  return wrapped ? { code: Number(wrapped[1]), message: wrapped[2] ?? '' } : undefined
}

export function acpErrorCode(error: OpenAbRpcError): number | undefined {
  return adapterError(error)?.code ?? error.code
}

/**
 * The provider answered HTTP 402: no usage left (Grok Build: `usage balance exhausted`). Only
 * credits or a reset fix it, so it is a product state, not a transport failure.
 */
const PROVIDER_PAYMENT_REQUIRED = /\(status 402 Payment Required\): ?([^\n]*)/u

/** Claude: -32603 `Internal error: <notice>`. Codex: bare `Internal error`, notice on a `> ` line. */
const CLAUDE_NOTICE = /^Internal error: (?:.* automatic compaction failed: )?([^\n]*)/u
const DETAIL_NOTICE = /(?:^|\n)Internal error\n> (?:Error running remote compact task: )?([^\n]*)/u
/** The SDK's `USAGE_LIMIT_ERROR_PREFIXES`, Codex's (curly apostrophe), Anthropic's hold, OpenCode's free tier. */
const CLAUDE_USAGE_LIMIT =
  /^(?:You['’]ve hit your|You['’]ve reached your|You['’]re out of usage credits|Your org is out of usage|(?:API Error: )?Your account can['’]t receive replies from Claude|The model provider refused the request: Free usage limit reached\b)/u
/** A credential the CLI can no longer use: Claude's `Failed to authenticate: …`, Codex's refusals and 401s. */
const CLAUDE_AUTH_FAILED =
  /^(?:Failed to authenticate\b|Invalid API key\b|unexpected status 401 Unauthorized\b|.*Please run \/login\b|workspace routing discovery unauthorized\b|Your access token could not be refreshed\b)/u
const isProductStateNotice = (n: string) => CLAUDE_USAGE_LIMIT.test(n) || CLAUDE_AUTH_FAILED.test(n)

/** The agent's own reason: after `Internal error: `, or a usage/sign-in notice on a `> ` line. */
export function claudeNotice(error: unknown): string | undefined {
  const adapter = error instanceof OpenAbRpcError ? adapterError(error) : undefined

  if (adapter?.code !== -32603) return undefined
  const notice = CLAUDE_NOTICE.exec(adapter.message)?.[1]?.trim()
  const detail = DETAIL_NOTICE.exec((error as OpenAbRpcError).message)?.[1]?.trim()

  return notice || (detail && isProductStateNotice(detail) ? detail : undefined)
}

/** Claude Code's notice when it names a usage limit or a sign-in failure, or undefined. */
export function claudeProductStateNotice(error: unknown): string | undefined {
  const notice = claudeNotice(error)

  return notice && isProductStateNotice(notice) ? notice : undefined
}

export function isRuntimeAuthRequired(error: unknown): boolean {
  if (!(error instanceof OpenAbRpcError)) return false
  if (CLAUDE_AUTH_FAILED.test(claudeNotice(error) ?? '')) return true

  const { code, message } = adapterError(error) ?? error

  return code === ACP_AUTH_REQUIRED_CODE && message.includes(ACP_AUTH_REQUIRED_MESSAGE)
}

export const RUNTIME_USAGE_EXHAUSTED_CODE = 'runtime_usage_exhausted'

/** The sentence a client shows for a provider that refuses to bill, or undefined. */
export function runtimeUsageExhaustedMessage(error: unknown): string | undefined {
  const notice = claudeNotice(error)

  if (notice && CLAUDE_USAGE_LIMIT.test(notice)) return notice
  // A caller may wrap the gateway's refusal, so its causes are read too.
  let match: RegExpExecArray | null = null
  let cause = error

  while (!match && cause instanceof Error) {
    match = PROVIDER_PAYMENT_REQUIRED.exec(cause.message)
    cause = cause.cause
  }
  if (!match) return undefined
  // The gateway appends its request id, which means nothing to the user.
  const reason = match[1]?.split(' requestId=')[0]?.trim()
  const detail = reason ? ` (${reason})` : ''

  return `This agent’s provider account has no usage left${detail}. Add credits or wait for its allowance to reset, or switch to another agent, then resend your message.`
}
