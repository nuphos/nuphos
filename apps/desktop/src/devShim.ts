// Dev-only shim that fakes the Electron preload bridge (window.api) when
// running in a regular browser (e.g. Preview MCP). All atlas:* calls go
// through the Vite proxy at /atlas-api which injects the CLI auth token
// server-side. K8s, agent, and updater methods return stub data — this shim
// only exists to exercise the Nuphos web UI and the Grafana proxy flow.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { agentStubsMethods } from './dev-shim/agentStubs.ts'
import { awsInfraMethods } from './dev-shim/awsInfra.ts'
import { awsLambdaLogsMethods } from './dev-shim/awsLambdaLogs.ts'
import { bindingsMethods } from './dev-shim/bindings.ts'
import { cloudflareInfraMethods } from './dev-shim/cloudflareInfra.ts'
import { cloudflarePagesD1Methods } from './dev-shim/cloudflarePagesD1.ts'
import { connectorsMethods } from './dev-shim/connectors.ts'
import { coreMethods } from './dev-shim/core.ts'
import { databasesKvMethods } from './dev-shim/databasesKv.ts'
import { instructionsMethods } from './dev-shim/instructions.ts'

export function installDevShim(): void {
  if (typeof window === 'undefined') return
  if ((window as any).api) return
  if (!import.meta.env.DEV) return

  const shim: Record<string, any> = {
    ...coreMethods(),
    ...cloudflareInfraMethods(),
    ...cloudflarePagesD1Methods(),
    ...databasesKvMethods(),
    ...bindingsMethods(),
    ...awsInfraMethods(),
    ...awsLambdaLogsMethods(),
    ...connectorsMethods(),
    ...agentStubsMethods(),
    ...instructionsMethods(),
  }

  // Proxy fallback: any bridge method the shim doesn't implement degrades to a
  // resolved no-op (event subscribers → an unsubscribe fn) instead of throwing
  // "x is not a function" and crashing the web renderer (ADR-0007 #3). The real
  // Electron preload has the full surface; this only bites in browser dev mode.
  ;(window as any).api = new Proxy(shim, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
      if (prop.startsWith('on')) return () => () => undefined // event subscriber → unsubscribe

      return () => Promise.resolve(undefined) // unknown call → resolved no-op
    },
  })
}
