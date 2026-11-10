import { OpenAbRpcError } from './openab-acp-errors'

export const RUNTIME_DISK_FULL_CODE = 'runtime_disk_full'
export const RUNTIME_INTERNAL_ERROR_CODE = 'runtime_internal_error'

const RUNTIME_FAILURES = {
  [RUNTIME_DISK_FULL_CODE]:
    'The agent’s runtime is out of disk space, so it could not run this turn. Free up disk space on the runtime or switch this conversation to another runtime, then resend your message.',
  [RUNTIME_INTERNAL_ERROR_CODE]:
    'The agent failed without saying why. Resend your message; if it keeps happening, check the runtime’s logs or switch this conversation to another runtime.',
} as const

export type RuntimeFailure = { code: keyof typeof RUNTIME_FAILURES; message: string }

const DISK_FULL = /\bENOSPC\b|no space left on device/iu
/** The shapes an adapter's -32603 takes on its way here when it carries no cause at all. */
const BARE_INTERNAL_ERROR =
  /^(?:JSON-RPC error -32603: Internal error|(?:\*\*Internal Error\*\* \(code: -32603\)\n)?Internal error(?:\n\n_The agent did not return any error details\.[^\n]*_)?)$/u

function runtimeFailureCode(error: unknown): RuntimeFailure['code'] | undefined {
  const messages = typeof error === 'string' ? [error] : []

  for (let cause = error; cause instanceof Error; cause = cause.cause) messages.push(cause.message)
  if (messages.some((message) => DISK_FULL.test(message))) return RUNTIME_DISK_FULL_CODE
  if (error instanceof OpenAbRpcError && BARE_INTERNAL_ERROR.test(error.message.trim())) {
    return RUNTIME_INTERNAL_ERROR_CODE
  }

  return undefined
}

/**
 * A runtime failure with a deterministic cause (an errno, or no cause at all) and a next
 * step, or undefined. Prose such as a process-death notice is the adapter's to word.
 */
export function runtimeFailure(error: unknown): RuntimeFailure | undefined {
  const code = runtimeFailureCode(error)

  return code ? { code, message: RUNTIME_FAILURES[code] } : undefined
}
