import { AppError } from '@/lib/errors'

const GENERIC_ERROR_NOTICE =
  'Nuphos hit an error while handling this request. The team has enough trace metadata to investigate.'

/** Turn expected runtime failures into actionable Slack guidance. */
export function slackAgentErrorNotice(err: unknown): string {
  if (!(err instanceof AppError)) return GENERIC_ERROR_NOTICE

  if (
    ['codex_setup_required', 'codex_runtime_starting', 'codex_runtime_unavailable'].includes(
      err.code,
    )
  ) {
    return `${err.message} Retry after the runtime shows Online in Nuphos Settings → Computers.`
  }

  if (err.code === 'claude_code_setup_required') {
    return (
      '*You have no runtime to run this message on, so it was not run.* ' +
      'Sign in to a runtime on a computer you can use in Nuphos, or pick one in Settings → Computers, then retry.'
    )
  }
  if (err.code === 'claude_code_runtime_starting') {
    return (
      '*Claude Code is not online yet, so this message was not run.* ' +
      'Ask a team administrator to check Nuphos Settings → Computers, wait for the runtime to show Online, then retry.'
    )
  }
  if (err.code === 'claude_code_runtime_unavailable') {
    return (
      '*The Claude Code runtime attached to this conversation is unavailable, so this message was not run.* ' +
      'Ask a team administrator to restore it from Nuphos Settings → Computers, then retry after the runtime shows Online.'
    )
  }

  return GENERIC_ERROR_NOTICE
}
