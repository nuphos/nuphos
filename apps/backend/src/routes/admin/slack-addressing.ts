import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { slackAddressingVerdicts } from '@/lib/slack/agent-bot/collections'
import { parseLimit } from '@/routes/admin/helpers'

import type { SlackAddressingVerdict } from '@/lib/slack/agent-bot/collections'
import type { AdminVars } from '@/routes/admin/auth'
import type { Hono } from 'hono'
import type { Filter } from 'mongodb'

const LIST_TEXT_CHARS = 300

function clip(value: string | undefined): string | undefined {
  if (value === undefined) return undefined

  return value.length > LIST_TEXT_CHARS ? `${value.slice(0, LIST_TEXT_CHARS)}…` : value
}

function addressedFilter(value: string | undefined): Filter<SlackAddressingVerdict> {
  if (value === 'true') return { addressed: true }
  if (value === 'false') return { addressed: false }
  if (value === 'null') return { addressed: null }

  return {}
}

function serializeVerdict(doc: SlackAddressingVerdict) {
  const { _id, ...rest } = doc

  return { id: _id?.toHexString() ?? '', ...rest }
}

export function registerAdminSlackAddressingRoutes(adminRoutes: Hono<{ Variables: AdminVars }>) {
  adminRoutes.get('/slack/addressing-verdicts', async (c) => {
    const limit = parseLimit(c.req.query('limit')) ?? 50
    const filter = addressedFilter(c.req.query('addressed'))
    const cursor = c.req.query('cursor')

    if (cursor) {
      const parsed = new Date(cursor)

      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, 'invalid_request', 'Invalid cursor')
      }
      filter.createdAt = { $lt: parsed }
    }

    const [docs, addressedCount, notAddressedCount, failOpenCount] = await Promise.all([
      slackAddressingVerdicts()
        .find(filter, {
          // The judge prompt is several KB per row — the list never shows it.
          projection: { prompt: 0 },
          sort: { createdAt: -1 },
          limit: limit + 1,
        })
        .toArray(),
      slackAddressingVerdicts().countDocuments({ addressed: true }),
      slackAddressingVerdicts().countDocuments({ addressed: false }),
      slackAddressingVerdicts().countDocuments({ addressed: null }),
    ])

    const hasMore = docs.length > limit

    if (hasMore) docs.pop()
    const last = docs[docs.length - 1]

    return c.json({
      verdicts: docs.map((doc) => ({
        ...serializeVerdict(doc),
        incomingText: clip(doc.incomingText) ?? '',
        reason: clip(doc.reason),
        rawOutput: clip(doc.rawOutput),
      })),
      counts: {
        addressed: addressedCount,
        notAddressed: notAddressedCount,
        failOpen: failOpenCount,
      },
      nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
      hasMore,
    })
  })

  adminRoutes.get('/slack/addressing-verdicts/:id', async (c) => {
    const id = c.req.param('id')

    if (!ObjectId.isValid(id)) throw new AppError(400, 'invalid_request', 'Invalid verdict id')
    const doc = await slackAddressingVerdicts().findOne({ _id: new ObjectId(id) })

    if (!doc) throw new AppError(404, 'not_found', 'Verdict not found')

    return c.json(serializeVerdict(doc))
  })
}
