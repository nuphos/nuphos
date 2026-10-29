import type { PreviewToolStep } from '@/lib/claude-code-preview/preview-transcript'

type ToolState = {
  name: string
  toolName: string
  input?: unknown
  hidden: boolean
  mcpToolName?: string
}

/**
 * Tool steps for the durable transcript, keyed by ACP tool-call id. Nuphos
 * tools invoked through the `nuphos-tools` MCP are recorded under their
 * classic name so reloaded conversations re-render the same cards.
 */
export function createPreviewToolLog() {
  const states = new Map<string, ToolState>()
  const steps = new Map<string, PreviewToolStep>()

  return {
    states,
    record(toolCallId: string, toolName: string, input: unknown) {
      const existing = steps.get(toolCallId)

      steps.set(toolCallId, {
        ...existing,
        toolCallId,
        toolName,
        input,
        startedAt: existing?.startedAt ?? Date.now(),
      })
    },
    complete(toolCallId: string, output: unknown) {
      const step = steps.get(toolCallId)

      if (step) steps.set(toolCallId, { ...step, output, completedAt: Date.now() })
    },
    /** The first failure is the cause; later reports (the agent's echo of a denial) don't replace it. */
    fail(toolCallId: string, errorText: string): string {
      const step = steps.get(toolCallId)

      if (step?.errorText !== undefined) return step.errorText
      if (step) steps.set(toolCallId, { ...step, errorText, completedAt: Date.now() })

      return errorText
    },
    list: (): PreviewToolStep[] => [...steps.values()],
  }
}
