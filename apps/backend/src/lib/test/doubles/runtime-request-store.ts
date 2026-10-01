import { beforeEach, mock } from 'bun:test'

import { buildDouble, makeInstaller } from '../double-registry'

import type { PreviewDecision, PreviewWait } from '@/lib/claude-code-preview/decision-waiter'

import * as actual from '@/lib/claude-code-preview/runtime-request-store'

const path = '@/lib/claude-code-preview/runtime-request-store'
const double = buildDouble(path, actual)

await mock.module('@/lib/claude-code-preview/runtime-request-store', () => double)
export const useRuntimeRequestStore = makeInstaller<typeof actual>(path)
/** Wire-contract fake; real state transitions are tested in Rust. */
export function useFakeRuntimeRequests() {
  const records = new Map<string, { wait: PreviewWait; decision: PreviewDecision | null }>()
  let available = true

  useRuntimeRequestStore({
    runtimeRequestStore: async (sessionId, params) => {
      if (!available) throw new Error('Runtime unavailable')
      const key = `${sessionId}:${String(params.waitId)}`
      const record = records.get(key)
      const owned = record?.wait.userId === params.userId ? record : undefined

      switch (params.operation) {
        case 'register':
          if (!record) records.set(key, { wait: params.wait as PreviewWait, decision: null })

          return { wait: records.get(key)?.wait }
        case 'list':
          return {
            waits: [...records.values()]
              .filter(
                (r) =>
                  r.wait.sessionId === sessionId && r.wait.userId === params.userId && !r.decision,
              )
              .map((r) => r.wait),
          }
        case 'read':
          return { wait: owned?.wait ?? null, decision: owned?.decision ?? null }
        case 'resolve':
          if (!owned || owned.decision) return { resolved: false }
          owned.decision = {
            ...(params.decision as PreviewDecision),
            kind: owned.wait.kind,
            resolvedAt: Date.now(),
          }

          return { resolved: true }
        case 'expire':
          if (owned) records.delete(key)

          return { ok: true }
        default:
          throw new Error('Unexpected runtime request RPC')
      }
    },
  })
  beforeEach(() => {
    records.clear()
    available = true
  })

  return {
    records,
    disconnect: () => {
      available = false
    },
    restart: () => {
      records.clear()
    },
  }
}
