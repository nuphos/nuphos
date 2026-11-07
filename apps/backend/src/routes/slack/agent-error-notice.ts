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
    return `${err.message} Retry after Runtime status shows Online in Nuphos Settings → Agent.`
  }

  if (err.code === 'claude_code_setup_required') {
    return (
      '*You have no agent to run this message on, so it was not run.* ' +
      'Sign in to an agent on a computer you can use in Nuphos, or pick one in Settings → Agent, then retry.'
    )
  }
  if (err.code === 'claude_code_runtime_starting') {
    return (
      '*Claude Code is not online yet, so this message was not run.* ' +
      'Ask a workspace administrator to check Nuphos Settings → Agent, wait for Runtime status to show Online, then retry.'
    )
  }
  if (err.code === 'claude_code_runtime_unavailable') {
    return (
      '*The Claude Code runtime attached to this conversation is unavailable, so this message was not run.* ' +
      'Ask a workspace administrator to restore it from Nuphos Settings → Agent, then retry after Runtime status shows Online.'
    )
  }

  return GENERIC_ERROR_NOTICE
}
