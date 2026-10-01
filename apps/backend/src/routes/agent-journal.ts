// Read API for the tamper-evident audit journal. Feeds the desktop journal
// timeline and the per-conversation Integrity badge.
//
// GET /agent-journal/:sessionId?teamId=...
//   → { events, integrity }
//
// The chain is recomputed on every request (bounded below), so the badge is a
// live verification, not a cached claim. Trust levels:
//   live     — hot-chain recomputation only
//   sealed   — every event is covered by a WORM segment
//   anchored — sealed AND the segment chain head has an external anchor newer
//              than the conversation's last event (conservative approximation)

import { Hono } from 'hono'

import { requireAuth } from '@/middleware/auth'
import { registerAgentJournalExportRoute } from '@/routes/agent-journal/export'
import { registerAgentJournalListRoute } from '@/routes/agent-journal/list'
import { registerAgentJournalSessionRoute } from '@/routes/agent-journal/session'

import type { AuthVariables } from '@/middleware/auth'

export const agentJournal = new Hono<{ Variables: AuthVariables }>()

agentJournal.use('*', requireAuth)

registerAgentJournalListRoute(agentJournal)
registerAgentJournalExportRoute(agentJournal)
registerAgentJournalSessionRoute(agentJournal)
