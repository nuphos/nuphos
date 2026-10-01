import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { dashboardPanelAlerts } from '@/models'

import { loadPanel } from './panels'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { DashboardPanelAlert } from '@/models'
import type { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Alerts (per-panel, Grafana-style; evaluated after each complete snapshot)
// ---------------------------------------------------------------------------

/** Discord webhook URLs and email recipient lists are delivery secrets; only
 *  editors/admins (who can also set them) see them in full. Read-only viewers
 *  get the channel type without the secret. */
function redactChannels(
  channels: DashboardPanelAlert['channels'],
): DashboardPanelAlert['channels'] {
  return channels.map((ch) =>
    ch.type === 'discord'
      ? { type: 'discord', webhookUrl: '' }
      : ch.type === 'email'
        ? { type: 'email', to: [] }
        : ch,
  )
}

function serializeAlert(doc: DashboardPanelAlert, redactSecrets = false) {
  return {
    id: doc._id.toHexString(),
    panelId: doc.panelId.toHexString(),
    enabled: doc.enabled,
    metric: doc.metric,
    condition: doc.condition,
    channels: redactSecrets ? redactChannels(doc.channels) : doc.channels,
    state: doc.state
      ? {
          breached: doc.state.breached,
          lastValue: doc.state.lastValue ?? null,
          lastEvaluatedAt: doc.state.lastEvaluatedAt.toISOString(),
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

// Discord webhook URLs are bearer-style secrets the backend POSTs to when an
// alert fires — pin them to a real Discord webhook host so a stored URL can't
// turn alert delivery into a server-side request to an internal endpoint (SSRF).
const discordWebhookUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (u) => /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(u),
    'must be a Discord webhook URL (https://discord.com/api/webhooks/…)',
  )

const alertChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('slack'), channelId: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('discord'), webhookUrl: discordWebhookUrl }),
  z.object({ type: z.literal('email'), to: z.array(z.string().email()).min(1).max(20) }),
])

const alertSchema = z.object({
  enabled: z.boolean(),
  metric: z.object({
    extract: z.enum(['scalar', 'series-last', 'series-sum', 'column-sum']),
    ref: z.string().trim().min(1).max(120).optional(),
  }),
  condition: z.object({
    op: z.enum(['gt', 'gte', 'lt', 'increase_pct']),
    threshold: z.number().finite(),
  }),
  channels: z.array(alertChannelSchema).min(1).max(10),
})

export function registerDashboardAlertRoutes(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  nuphosDashboardsRoutes.get('/:dashboardId/panels/:panelId/alert', async (c) => {
    const { teamId, panel } = await loadPanel(
      c.get('teamId'),
      c.req.param('dashboardId'),
      c.req.param('panelId'),
    )
    const alert = await dashboardPanelAlerts().findOne({ teamId, panelId: panel._id })
    const role = c.get('teamRole')
    const redact = role !== 'ADMINISTRATOR' && role !== 'EDITOR'

    return c.json({ alert: alert ? serializeAlert(alert, redact) : null })
  })

  nuphosDashboardsRoutes.put(
    '/:dashboardId/panels/:panelId/alert',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', alertSchema),
    async (c) => {
      const { teamId, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const input = c.req.valid('json')
      const now = new Date()
      const alert = await dashboardPanelAlerts().findOneAndUpdate(
        { teamId, panelId: panel._id },
        {
          $set: {
            enabled: input.enabled,
            metric: input.metric,
            condition: input.condition,
            channels: input.channels,
            updatedAt: now,
          },
          $setOnInsert: { _id: new ObjectId(), teamId, panelId: panel._id, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      )

      if (!alert) throw new AppError(500, 'alert_save_failed', 'Alert could not be saved')

      return c.json(serializeAlert(alert))
    },
  )

  nuphosDashboardsRoutes.delete(
    '/:dashboardId/panels/:panelId/alert',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    async (c) => {
      const { teamId, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )

      await dashboardPanelAlerts().deleteOne({ teamId, panelId: panel._id })

      return c.json({ ok: true })
    },
  )
}
