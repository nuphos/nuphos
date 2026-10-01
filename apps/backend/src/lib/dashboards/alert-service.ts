import { isEmailConfigured, sendEmail } from '@/lib/email'
import { logError } from '@/lib/observability'
import { postSlackMessage } from '@/lib/slack/api'
import { resolveSlackBotForTeam } from '@/lib/slack/installations'
import { dashboardPanelAlerts, dashboardPanelSnapshots } from '@/models'

import type {
  DashboardPanel,
  DashboardPanelAlert,
  DashboardPanelOutput,
  DashboardPanelSnapshot,
} from '@/models'
import type { ObjectId } from 'mongodb'

/** Pull the numeric the rule watches out of a validated panel output. Returns
 *  null when the shape doesn't carry the referenced value. */
export function extractMetric(
  output: DashboardPanelOutput,
  metric: DashboardPanelAlert['metric'],
): number | null {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  if (metric.extract === 'scalar') {
    return output.kind === 'scalar' ? num(output.value) : null
  }
  if (metric.extract === 'series-last' || metric.extract === 'series-sum') {
    if (output.kind !== 'chart') return null
    const key = metric.ref ?? output.series[0]?.key

    if (!key) return null
    if (metric.extract === 'series-last') {
      for (let i = output.data.length - 1; i >= 0; i--) {
        const v = num(output.data[i]![key])

        if (v !== null) return v
      }

      return null
    }

    return output.data.reduce((acc, row) => acc + (num(row[key]) ?? 0), 0)
  }
  // column-sum
  if (output.kind !== 'table') return null
  const key = metric.ref ?? output.columns.find((c) => c.numeric)?.key

  if (!key) return null

  return output.rows.reduce((acc, row) => acc + (num(row[key]) ?? 0), 0)
}

function evaluateCondition(
  value: number,
  condition: DashboardPanelAlert['condition'],
  previous: number | null,
): boolean {
  switch (condition.op) {
    case 'gt':
      return value > condition.threshold
    case 'gte':
      return value >= condition.threshold
    case 'lt':
      return value < condition.threshold
    case 'increase_pct':
      if (previous === null || previous === 0) return false

      return ((value - previous) / previous) * 100 >= condition.threshold
  }
}

/** Deliver a transition to every configured channel. Returns true if at least
 *  one channel actually accepted the message, so the caller only commits the
 *  state flip once the transition has been delivered somewhere. */
async function notify(
  alert: DashboardPanelAlert,
  panel: DashboardPanel,
  breached: boolean,
  value: number,
): Promise<boolean> {
  const transition = breached ? 'Panel alert triggered' : 'Panel alert resolved'
  const line = `${transition}: ${panel.title}\nCurrent value: ${value.toLocaleString()} (${alert.condition.op} ${String(alert.condition.threshold)})`
  let delivered = false

  for (const channel of alert.channels) {
    try {
      if (channel.type === 'slack') {
        const bot = await resolveSlackBotForTeam(alert.teamId)

        if (!bot) continue
        await postSlackMessage({ token: bot.botToken, channel: channel.channelId, text: line })
        delivered = true
      } else if (channel.type === 'discord') {
        const res = await fetch(channel.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: line }),
          signal: AbortSignal.timeout(10_000),
        })

        // fetch only rejects on transport errors; a 4xx/5xx webhook is a
        // delivery failure too, so treat it as not-delivered (retry next eval).
        if (!res.ok) throw new Error(`discord webhook responded ${String(res.status)}`)
        delivered = true
      } else if (channel.type === 'email') {
        if (!isEmailConfigured()) continue
        await Promise.all(
          channel.to.map((to) =>
            sendEmail({
              to,
              subject: `${transition}: ${panel.title}`,
              text: line,
              html: `<p>${line.replace(/\n/g, '<br>')}</p>`,
            }),
          ),
        )
        delivered = true
      }
    } catch (err) {
      logError('dashboard.alert.notify_failed', err, {
        panel_id: panel._id.toHexString(),
        channel: channel.type,
      })
    }
  }

  return delivered
}

/**
 * Evaluate a panel's alert against a freshly-completed snapshot. Edge-triggered:
 * only notifies when the breached state flips (mirrors v1 evaluateAlert). Safe
 * to call after every complete snapshot; a no-op when there's no enabled alert.
 */
export async function evaluatePanelAlert(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
}): Promise<void> {
  const { teamId, panel, snapshot } = args

  if (snapshot.viewOnly || snapshot.status !== 'complete' || !snapshot.output) return
  const alert = await dashboardPanelAlerts().findOne({ teamId, panelId: panel._id })

  if (!alert?.enabled) return

  // Runs for one panel can overlap (a cadence refresh alongside a manual force
  // refresh), and the newer one can finish first. Anything derived from a
  // snapshot older than the one the state already reflects is stale: skip it
  // entirely rather than notify on, or persist, superseded data.
  const lastSnapshotAt = alert.state?.lastSnapshotAt

  if (lastSnapshotAt && snapshot.requestedAt <= lastSnapshotAt) return

  const value = extractMetric(snapshot.output, alert.metric)

  if (value === null) return

  let previous: number | null = null

  if (alert.condition.op === 'increase_pct') {
    // Compare against the previous run of the same script (the prior period) —
    // NOT the same params. A rolling range (e.g. Last 30 days on daily cadence)
    // advances its window each day, so requiring an identical paramsHash would
    // leave `previous` null forever and increase_pct alerts would never fire.
    // Bounded by this snapshot's own requestedAt so an overlapping newer run
    // can't become this run's "previous" period.
    const prevSnap = await dashboardPanelSnapshots()
      .find({
        teamId,
        panelId: panel._id,
        status: 'complete',
        viewOnly: { $ne: true },
        codeHash: snapshot.codeHash,
        _id: { $ne: snapshot._id },
        requestedAt: { $lt: snapshot.requestedAt },
      })
      .sort({ requestedAt: -1 })
      .limit(1)
      .next()

    previous = prevSnap?.output ? extractMetric(prevSnap.output, alert.metric) : null
  }

  const breached = evaluateCondition(value, alert.condition, previous)
  const wasBreached = alert.state?.breached ?? false
  const now = new Date()
  // Observability fields always advance, together with the fence that marks
  // which snapshot this state now reflects.
  const observed = {
    'state.lastValue': value,
    'state.lastEvaluatedAt': now,
    'state.lastSnapshotAt': snapshot.requestedAt,
    updatedAt: now,
  }
  // Re-check the fence inside every write: the read above is not atomic, so a
  // newer snapshot may have landed while we were extracting the metric.
  const notSuperseded = isNewerThanStoredSnapshot(snapshot.requestedAt)

  if (breached === wasBreached) {
    await dashboardPanelAlerts().updateOne(
      { _id: alert._id, teamId, ...notSuperseded },
      { $set: { 'state.breached': breached, ...observed } },
    )

    return
  }

  // Edge. The execution gate deliberately allows concurrent runs for one panel
  // (a cadence refresh can overlap a manual force refresh), so two evaluations
  // can read the same old state and both try to deliver. Claim the flip with a
  // conditional write first: the guards on the previous value and the snapshot
  // fence mean exactly one writer transitions, and only that writer notifies.
  const claim = await dashboardPanelAlerts().updateOne(
    { _id: alert._id, teamId, ...breachedIs(wasBreached), ...notSuperseded },
    { $set: { 'state.breached': breached, ...observed } },
  )

  if (claim.modifiedCount === 0) {
    // Lost the race — either the winner delivers this transition, or a newer
    // snapshot already moved the state past ours. Advance the observability
    // fields only if we are still the newest evaluation.
    await dashboardPanelAlerts().updateOne(
      { _id: alert._id, teamId, ...notSuperseded },
      { $set: observed },
    )

    return
  }

  // If the transition can't be delivered to any channel (transient outage), roll
  // the flip back so the next evaluation retries — otherwise the state is
  // recorded and the edge-trigger permanently swallows the notification. Guarded
  // on the fence too, so a newer evaluation that already superseded us wins.
  const delivered = await notify(alert, panel, breached, value)

  if (!delivered) {
    await dashboardPanelAlerts().updateOne(
      {
        _id: alert._id,
        teamId,
        ...breachedIs(breached),
        'state.lastSnapshotAt': snapshot.requestedAt,
      },
      { $set: { 'state.breached': wasBreached, updatedAt: new Date() } },
    )
  }
}

/** Filter fragment matching alerts whose stored breached flag is `value`.
 *  `$ne: true` also covers alerts that have never been evaluated (no `state`). */
function breachedIs(value: boolean) {
  return value ? { 'state.breached': true } : { 'state.breached': { $ne: true } }
}

/** Filter fragment matching alerts whose recorded snapshot is older than
 *  `requestedAt` — i.e. this evaluation has not been superseded. Alerts written
 *  before the fence existed carry no `lastSnapshotAt` and always pass. */
function isNewerThanStoredSnapshot(requestedAt: Date) {
  return {
    $or: [
      { 'state.lastSnapshotAt': { $exists: false } },
      { 'state.lastSnapshotAt': { $lt: requestedAt } },
    ],
  }
}
