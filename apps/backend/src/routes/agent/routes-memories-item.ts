import { deleteMemoryWire, getMemoryWire } from '@/lib/agent/memory-slots/records-wire'
import { AppError } from '@/lib/errors'

import { agent } from './router'
import { memoryViewer, readMemoryScope } from './routes-memories'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.get('/memories/:memoryId', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const scope = readMemoryScope(c)
  const result = await getMemoryWire(memoryViewer(userId, teamId, scope), c.req.param('memoryId'))

  // Null = no usable provider — an ops problem, never "the memory is gone".
  if (!result) throw new AppError(503, 'memory_unavailable', 'Memory provider unavailable')
  if (!result.item) throw new AppError(404, 'not_found', 'Memory not found')

  return c.json(result.item)
})

agent.delete('/memories/:memoryId', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const scope = readMemoryScope(c)
  // Optional human-stated removal reason (sanitized + capped inside the
  // provider's store — forwarded verbatim through the SPI, single-redaction)
  // — shown in the Removed view and echoed by the non-resurrection gate.
  // Read from the JSON body only: free-form text in a query param would
  // leak into access logs, proxies, and tunnel logs.
  let reason: string | undefined

  try {
    const body = await c.req.json()

    if (typeof body.reason === 'string' && body.reason.trim()) reason = body.reason.trim()
  } catch {
    // no body — reason simply absent
  }
  const deleted = await deleteMemoryWire(
    memoryViewer(userId, teamId, scope),
    c.req.param('memoryId'),
    reason,
  )

  if (!deleted) throw new AppError(503, 'memory_unavailable', 'Memory provider unavailable')
  // supported:false (no delete capability) and a miss both read as 404 — the
  // affordance shouldn't exist client-side either way.
  if (!deleted.ok) throw new AppError(404, 'not_found', 'Memory not found')

  return c.json({ ok: true, provider: deleted.provider })
})

// Conversation history endpoints
