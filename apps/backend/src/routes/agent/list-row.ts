/**
 * A list row without what only the open conversation or the server reads.
 * Clients poll the whole list every few seconds, and the runtime attachment
 * and the per-model token breakdown were a third of each row. Lists show only
 * the cost. The credential selection stays: the desktop chat summary counts
 * it from the polled row.
 */
export function listRow(row: Record<string, unknown>): Record<string, unknown> {
  const {
    claudeCodePreview: _claudeCodePreview,
    claudeCodePreviewContext: _claudeCodePreviewContext,
    claudeCodePreviewWorkLost: _claudeCodePreviewWorkLost,
    initialSessionConfig: _initialSessionConfig,
    compactionSummary: _compactionSummary,
    compactionMessageCount: _compactionMessageCount,
    conversationTraceParent: _conversationTraceParent,
    runtimeMigration: _runtimeMigration,
    modelFallback: _modelFallback,
    tokenUsage,
    ...rest
  } = row
  const costUsd = (tokenUsage as { costUsd?: unknown } | undefined)?.costUsd

  return typeof costUsd === 'number' ? { ...rest, tokenUsage: { costUsd } } : rest
}
