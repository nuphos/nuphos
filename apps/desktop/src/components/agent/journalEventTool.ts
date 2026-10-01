/**
 * payload.success only says the tool's execute() returned — a bash command
 * exiting 1 is a normal return with success: true. For an audit timeline the
 * scan-relevant question is "did the command fail", so a non-zero exit code
 * counts as failure regardless of the transport-level flag.
 */
export function toolResultFailed(
  payload: Record<string, unknown>,
  exitCode: number | null,
): boolean {
  return payload.success !== true || (exitCode !== null && exitCode !== 0)
}

export function toolNameOf(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.toolName === 'string' ? payload.toolName : fallback
}
