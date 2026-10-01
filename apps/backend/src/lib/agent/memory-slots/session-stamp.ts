// Session-creation provider stamping, in a registry-free module: db.ts calls
// this at conversation upsert, and importing it must not drag in the provider
// registry (runtime → index → native → identity → db.ts would be an import
// cycle). Kept apart from runtime.ts for that reason alone — runtime re-exports
// it, so call sites outside db.ts keep importing from runtime.

import { config } from '@/config'

/** Called once when a conversation is created: the provider the session is
 * stamped with. Global default today; Phase 3 adds the team override input. */
export function resolveForNewSession(_team: { teamId: string | null }): { providerId: string } {
  return { providerId: config.agent.memoryProvider }
}
