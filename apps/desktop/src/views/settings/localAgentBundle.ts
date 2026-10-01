import type { RuntimeStatusView } from './runtimePresentation.ts'
import type { DevBundleHint } from '../../api/device-types.ts'

export const PREPARE_COMMAND = 'node apps/desktop/local-runtime/prepare.mjs'

/** What an agent's status line says when this build has no bundle for it. */
export function unbundledStatus(name: string, devBundle?: DevBundleHint): RuntimeStatusView {
  switch (devBundle?.state) {
    case 'preparing':
      return { label: 'Preparing the local agent… (bun run dev builds it)', tone: 'pending' }
    case 'failed':
      return {
        label: `Preparing the local agent failed: ${devBundle.reason}. Fix it, then press r in bun run dev.`,
        tone: 'error',
      }
    case 'missing':
      return { label: `Local agent not built yet. Run ${PREPARE_COMMAND}`, tone: 'off' }
    case undefined:
      return { label: `This build of Nuphos does not include ${name}.`, tone: 'off' }
  }
}
