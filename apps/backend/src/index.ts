// MUST be the first import: bootstrap.ts awaits telemetry setup at module
// evaluation, before AWS / GCP / AI SDK imports can capture an unpatched fetch
// and before any module caches a metric instrument from the no-op meter. It is
// a bare import because import sorting moves named imports, and did: metrics
// were never exported while this sat below '@/index-app'.
import '@/otel/bootstrap'

import { config } from '@/config'
import { app, websocket } from '@/index-app'
import { startBotImportCleanup } from '@/lib/agent/bot-import/cleanup'
import { wakeOnRuntime } from '@/lib/agent/channel-missed-posts'
import { startFreeBoxSweep } from '@/lib/agent/devices/box-free-sweep'
import { closeTunnelsForRestart } from '@/lib/agent/devices/local-runtime/holder'
import { conversationAutoArchive } from '@/lib/agent/conversation-auto-archive'
import { assertRegistryInvariants } from '@/lib/agent/memory-slots'
import {
  initMemoryRetentionRollup,
  shutdownMemoryRetentionRollup,
} from '@/lib/agent/memory-slots/attribution-store'
import { cancelOpenAgentPlans } from '@/lib/agent/plans'
import { drainAgentProducers, drainHttpAndAgentProducers } from '@/lib/agent/producer-drain'
import { startQueuedTurn } from '@/lib/agent/queued-turn'
import { flushGuardWrites } from '@/lib/agent/run-store'
import { installQueuedTurnStarter } from '@/lib/agent/session-released'
import { initStuckTurnProbe, shutdownStuckTurnProbe } from '@/lib/agent/stuck-turn-probe'
import { flushTraceWrites, setupTraceIndexes } from '@/lib/agent/trace-store/store'
import { initTriggerScheduler } from '@/lib/agent/trigger-scheduler'
import { quiesceAgentWorkers, closeAgentWorkerQueues } from '@/lib/agent/worker-shutdown'
import { validateAwsOidcConfig } from '@/lib/byos/aws-oidc'
import { installRuntimeWake } from '@/lib/claude-code-preview/agent-chat-registry'
import {
  publishRuntimeHandoffs,
  startRuntimeHandoffAdoption,
} from '@/lib/claude-code-preview/runtime-handoff'
import {
  initRuntimeMetricsSampler,
  shutdownRuntimeMetricsSampler,
} from '@/lib/claude-code-preview/runtime-metrics-sampler'
import { recoverDashboardPanelExecutions } from '@/lib/dashboards/exec-service'
import { dashboardRefreshScheduler } from '@/lib/dashboards/refresh-schedule'
import { connectDb, closeDb } from '@/lib/db'
import { watchDevLauncher } from '@/lib/dev-launcher-watchdog'
import { devTlsOptions } from '@/lib/dev-tls'
import { initDiscordGateway, shutdownDiscordGateway } from '@/lib/discord/gateway'
import { startEventLoopStallLog } from '@/lib/event-loop-stall'
import { backfillPersonalTokenExpiry } from '@/lib/identity/cli-tokens'
import { initInternalTokens } from '@/lib/internal-token'
import { initJournalSealer, shutdownJournalSealer } from '@/lib/journal/seal-scheduler'
import { markShuttingDown } from '@/lib/lifecycle'
import { setupMcpOAuthIndexes } from '@/lib/oauth/store'
import { logError, logEvent } from '@/lib/observability'
import { shutdownPostHog } from '@/lib/posthog'
import { closeRedis } from '@/lib/redis'
import { startHealthTelemetry } from '@/lib/telemetry/report'
import { startWebhookDelivery } from '@/lib/webhooks/deliver'
import {
  setupIndexes,
  tolerateIndexConflict,
  migrateLegacyAliyunBindings,
  migrateLegacyTencentBindings,
} from '@/models'
import { shutdownTelemetry } from '@/otel/bootstrap'
import { drainInFlightAgentRuns, startAgentRunStallSweeper } from '@/routes/agent'

// A killed terminal/launcher cannot run its normal process-group teardown.
// Before startup completes SIGTERM exits directly; afterward it drains below
// and stops reconciliation immediately, before the potentially long drain.
watchDevLauncher(config.devLauncherPid, () => {
  logEvent('warn', 'backend.dev_launcher.exited')
  process.kill(process.pid, 'SIGTERM')
})

// Fail fast on a malformed signing key; load the conversation-token key first.
validateAwsOidcConfig()

await Promise.all([connectDb(), initInternalTokens()])
await setupTraceIndexes().catch((error: unknown) => {
  logError('agent.trace.indexes_failed', error)
})
logEvent('info', 'backend.mongodb.connected')
// Memory provider registry boot gate: a malformed provider bundle or a
// MEMORY_PROVIDER default naming an unregistered/external provider fails the
// deploy here, never a turn (SPI spec §a; A1 external-as-default rejection).
assertRegistryInvariants()
// Build indexes before listening (groups run in parallel). Several carry UNIQUE indexes
// (identity, email-otp, invitations, slack/lark, …), and serving before they exist would let
// duplicate records in on a fresh deploy. Index-spec conflicts (Mongo 85/86) are tolerated per
// group (see tolerateIndexConflict); anything else fails the boot.
await setupIndexes()
await tolerateIndexConflict(setupMcpOAuthIndexes, 'mcp-oauth')
logEvent('info', 'backend.mongodb.indexes_ready')
await recoverDashboardPanelExecutions()

// One-time backfill: drop pre-OIDC Aliyun bindings (no roleArn) so they don't
// surface as permanently-broken accounts after the AccessKey → RAM-role
// migration. Idempotent — a no-op once none remain.
const removedAliyun = await migrateLegacyAliyunBindings()

if (removedAliyun > 0) {
  logEvent('info', 'backend.migration.aliyun_legacy_bindings_removed', { teams: removedAliyun })
}
// Same for the Tencent SecretId/SecretKey -> CAM-role-OIDC migration.
const removedTencent = await migrateLegacyTencentBindings()

if (removedTencent > 0) {
  logEvent('info', 'backend.migration.tencent_legacy_bindings_removed', { teams: removedTencent })
}
// Plans were replaced by approval decisions (#2316): an agent Plan still open
// would wait forever. Idempotent — a no-op once none remain.
const cancelledPlans = await cancelOpenAgentPlans()

if (cancelledPlans > 0) {
  logEvent('info', 'backend.migration.agent_plans_cancelled', { plans: cancelledPlans })
}

await backfillPersonalTokenExpiry()

// A queued message starts when the turn ahead lets go; a runtime back wakes its agents.
installQueuedTurnStarter(startQueuedTurn)
installRuntimeWake(wakeOnRuntime)
await dashboardRefreshScheduler.init()
if (await initTriggerScheduler()) {
  logEvent('info', 'backend.trigger_scheduler.ready')
}

if (await initJournalSealer()) {
  logEvent('info', 'backend.journal_sealer.ready')
}

conversationAutoArchive.init()
// Track A 2.2: hourly retention-score recompute (idempotent full upsert).
initMemoryRetentionRollup()
logEvent('info', 'backend.memory_retention_rollup.ready')

// Counts turns stranded on an unanswered tool call — the one agent failure no
// request can observe, because it IS the missing request.
initStuckTurnProbe()
logEvent('info', 'backend.stuck_turn_probe.ready')

initRuntimeMetricsSampler()
startAgentRunStallSweeper()
const stopBotImportCleanup = startBotImportCleanup()
const stopFreeBoxSweep = startFreeBoxSweep()
const stopWebhookDelivery = startWebhookDelivery()
const stopRuntimeHandoffAdoption = startRuntimeHandoffAdoption()

if (await initDiscordGateway()) logEvent('info', 'backend.discord_gateway.ready')
startHealthTelemetry()
startEventLoopStallLog()

// Bun only prints these; log them so the next one names its request and time.
process.on('unhandledRejection', (error) => {
  logError('backend.unhandled_rejection', error)
})

const tls = devTlsOptions()

const server = Bun.serve({
  port: config.port,
  // Bun defaults to a 10s idle timeout, which drops a legitimately slow request
  // (e.g. a burst of reads while MongoDB is reachable only over a high-latency
  // path) mid-flight — the client sees "other side closed". Raise it so slow
  // requests complete instead of failing; healthy requests close normally well
  // before this, so it's inert in prod.
  idleTimeout: 120,
  ...(tls ? { tls } : {}),
  websocket,
  async fetch(req, bunServer) {
    // No global shutdown gate here: readiness (→503) drains the LB and new agent
    // runs are gated at registration, so resumes/in-flight requests keep working
    // during the drain window. server.stop() is the point we stop new connections.
    return app.fetch(req, { server: bunServer })
  },
})

logEvent('info', 'backend.server.listening', {
  protocol: tls ? 'https' : 'http',
  host: 'localhost',
  port: config.port,
})

const devHttpServer = config.server.devHttpPort
  ? Bun.serve({
      port: config.server.devHttpPort,
      idleTimeout: 120,
      websocket,
      fetch: (req, bunServer) => app.fetch(req, { server: bunServer }),
    })
  : undefined

const shutdownBudget = config.shutdown

if (!shutdownBudget.fitsWithinGrace) {
  logEvent('error', 'backend.shutdown.budget_exceeds_grace_period', {
    ...shutdownBudget,
    hint:
      'terminationGracePeriodSeconds is too small for even the fixed HTTP drain + guard flush; ' +
      'this pod will be SIGKILLed mid-shutdown. Raise it on the Deployment.',
  })
} else if (shutdownBudget.clamped) {
  logEvent('warn', 'backend.shutdown.budget_clamped', {
    ...shutdownBudget,
    hint:
      'The requested drain does not fit in terminationGracePeriodSeconds and was reduced. ' +
      'Raise terminationGracePeriodSeconds (and TERMINATION_GRACE_SECONDS alongside it) to ' +
      'give in-flight agent turns their full window.',
  })
} else {
  logEvent('info', 'backend.shutdown.budget_ready', shutdownBudget)
}

let shutdownStarted = false

async function shutdown(sig: string) {
  if (shutdownStarted) return
  shutdownStarted = true
  logEvent('info', 'backend.shutdown.started', { signal: sig })
  markShuttingDown()
  // 1. Stop schedulers and background loops so nothing new touches storage.
  dashboardRefreshScheduler.shutdown()
  shutdownRuntimeMetricsSampler()
  shutdownDiscordGateway()
  shutdownMemoryRetentionRollup()
  conversationAutoArchive.shutdown()
  shutdownStuckTurnProbe()
  stopBotImportCleanup()
  stopFreeBoxSweep()
  stopWebhookDelivery()
  const workersStopped = Promise.allSettled([quiesceAgentWorkers(), shutdownJournalSealer()])

  // Let k8s see /health/ready return 503 and deregister this pod first.
  await new Promise((r) => setTimeout(r, shutdownBudget.lbGraceMs))

  // 2. Drain in-flight agent SSE runs first: one force-closed mid-stream reaches clients as a 502.
  try {
    await drainInFlightAgentRuns(shutdownBudget.agentDrainForcePauseAtMs)
  } catch (err) {
    logError('backend.shutdown.agent_run_drain_failed', err, {
      drain_deadline_ms: shutdownBudget.agentDrainDeadlineMs,
      force_pause_at_ms: shutdownBudget.agentDrainForcePauseAtMs,
    })
  }

  // 3. Send computers to a ready replica (their tunnels never end on their own), then drain HTTP.
  closeTunnelsForRestart()
  const forceTimer = setTimeout(() => {
    logEvent('warn', 'backend.shutdown.drain_deadline_exceeded', {
      drain_deadline_ms: shutdownBudget.httpDrainMs,
    })
    void server.stop(true)
    void devHttpServer?.stop(true)
  }, shutdownBudget.httpDrainMs)

  try {
    await drainHttpAndAgentProducers(
      () => Promise.all([server.stop(false), devHttpServer?.stop(false)]),
      shutdownBudget.httpDrainMs,
      workersStopped,
    )
  } catch (err) {
    logError('backend.shutdown.server_stop_failed', err)
  }
  clearTimeout(forceTimer)
  stopRuntimeHandoffAdoption()
  try {
    await publishRuntimeHandoffs()
  } catch (err) {
    logError('backend.shutdown.runtime_handoff_failed', err)
  }

  // 4. Flush busy-guard releases before Redis closes; the owner-lease sweep covers later ones.
  await Promise.allSettled([
    flushGuardWrites(shutdownBudget.guardFlushMs).catch((err: unknown) => {
      logError('backend.shutdown.guard_flush_failed', err, {
        flush_deadline_ms: shutdownBudget.guardFlushMs,
      })
    }),
    flushTraceWrites(shutdownBudget.guardFlushMs).catch((error: unknown) => {
      logError('backend.shutdown.trace_flush_failed', error)
    }),
  ])
  await closeAgentWorkerQueues()

  // 5. Flush exporters while storage is open, so work detached by server.stop(true) still succeeds.
  await Promise.allSettled([
    shutdownPostHog(),
    shutdownTelemetry().catch((err: unknown) => {
      logError('backend.shutdown.telemetry_shutdown_failed', err)
    }),
  ])

  // 6. Let transcript writes started by closed tunnels land, then close storage and exit at once.
  await drainAgentProducers(shutdownBudget.guardFlushMs)
  await Promise.allSettled([closeRedis(), closeDb()])
  process.exit(0)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig))
}
