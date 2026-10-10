// MUST be the first import: bootstrap.ts awaits telemetry setup at module
// evaluation, before AWS / GCP / AI SDK imports can capture an unpatched fetch.

import { existsSync } from 'node:fs'

import { config } from '@/config'
import { app, websocket } from '@/index-app'
import { conversationAutoArchive } from '@/lib/agent/conversation-auto-archive'
import { assertRegistryInvariants } from '@/lib/agent/memory-slots'
import {
  initMemoryRetentionRollup,
  shutdownMemoryRetentionRollup,
} from '@/lib/agent/memory-slots/attribution-store'
import { drainHttpAndAgentProducers } from '@/lib/agent/producer-drain'
import { flushGuardWrites } from '@/lib/agent/run-store'
import { initStuckTurnProbe, shutdownStuckTurnProbe } from '@/lib/agent/stuck-turn-probe'
import { flushTraceWrites, setupTraceIndexes } from '@/lib/agent/trace-store/store'
import { initTriggerScheduler } from '@/lib/agent/trigger-scheduler'
import { quiesceAgentWorkers, closeAgentWorkerQueues } from '@/lib/agent/worker-shutdown'
import { validateAwsOidcConfig } from '@/lib/byos/aws-oidc'
import {
  publishRuntimeHandoffs,
  startRuntimeHandoffAdoption,
} from '@/lib/claude-code-preview/runtime-handoff'
import {
  initClaudeCodeRuntimeProvisioner,
  shutdownClaudeCodeRuntimeProvisioner,
} from '@/lib/claude-code-preview/runtime-provisioner'
import { recoverDashboardPanelExecutions } from '@/lib/dashboards/exec-service'
import { recoverDashboardPanelInsights } from '@/lib/dashboards/insight-service'
import { dashboardRefreshScheduler } from '@/lib/dashboards/refresh-schedule'
import { connectDb, closeDb } from '@/lib/db'
import { watchDevLauncher } from '@/lib/dev-launcher-watchdog'
import { initDiscordGateway, shutdownDiscordGateway } from '@/lib/discord/gateway'
import { initJournalSealer, shutdownJournalSealer } from '@/lib/journal/seal-scheduler'
import { markShuttingDown } from '@/lib/lifecycle'
import { setupMcpOAuthIndexes } from '@/lib/oauth/store'
import { logError, logEvent } from '@/lib/observability'
import { shutdownPostHog } from '@/lib/posthog'
import { closeRedis } from '@/lib/redis'
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

// Fail fast on a malformed OIDC signing key — better a crashed deploy than
// request-time 500s on /.well-known and AWS web-identity assumes.
validateAwsOidcConfig()

await connectDb()
await setupTraceIndexes()
logEvent('info', 'backend.mongodb.connected')
// Memory provider registry boot gate: a malformed provider bundle or a
// MEMORY_PROVIDER default naming an unregistered/external provider fails the
// deploy here, never a turn (SPI spec §a; A1 external-as-default rejection).
assertRegistryInvariants()
// Build indexes before listening. setupIndexes() runs its groups in parallel
// (Promise.all), so the old serial ~24s cost is gone — but this deliberately
// stays on the startup path: several groups carry UNIQUE indexes (identity,
// email-otp, invitations, slack/lark, …), and serving requests before
// those constraints exist would let duplicate/invalid records slip in on a fresh
// deploy. Index-spec conflicts (Mongo 85/86) are tolerated per group — see
// tolerateIndexConflict. Everything else still fails the boot.
await setupIndexes()
await tolerateIndexConflict(setupMcpOAuthIndexes, 'mcp-oauth')
logEvent('info', 'backend.mongodb.indexes_ready')
await Promise.all([recoverDashboardPanelExecutions(), recoverDashboardPanelInsights()])

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

if (initClaudeCodeRuntimeProvisioner()) {
  logEvent('info', 'backend.claude_code_runtime_provisioner.ready')
}
startAgentRunStallSweeper()
const stopRuntimeHandoffAdoption = startRuntimeHandoffAdoption()

if (await initDiscordGateway()) logEvent('info', 'backend.discord_gateway.ready')

const tls = getTlsOptions()

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
  dashboardRefreshScheduler.shutdown()
  // Stop reconciliation before draining so the old backend cannot overwrite
  // runtime Deployments after the replacement revision takes ownership.
  shutdownClaudeCodeRuntimeProvisioner()
  shutdownDiscordGateway()
  const workersStopped = quiesceAgentWorkers()

  // Give k8s time to observe /health/ready returning 503 and deregister this
  //    pod from Service endpoints before we stop accepting new connections.
  await new Promise((r) => setTimeout(r, shutdownBudget.lbGraceMs))

  // 2. Drain in-flight agent SSE runs first — a pod-local run force-closed
  //    mid-stream surfaces to clients as a 502.
  try {
    await drainInFlightAgentRuns(shutdownBudget.agentDrainForcePauseAtMs)
  } catch (err) {
    logError('backend.shutdown.agent_run_drain_failed', err, {
      drain_deadline_ms: shutdownBudget.agentDrainDeadlineMs,
      force_pause_at_ms: shutdownBudget.agentDrainForcePauseAtMs,
    })
  }

  // 3. Drain HTTP and detached producers within the same deadline before closing storage.
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

  // 4. Flush asynchronous busy-guard releases before Redis closes so sessions
  //    are not blocked until their lease TTL expires. The run-store owner-lease
  //    sweep remains the fallback for releases that arrive after this point.
  try {
    await flushGuardWrites(shutdownBudget.guardFlushMs)
  } catch (err) {
    logError('backend.shutdown.guard_flush_failed', err, {
      flush_deadline_ms: shutdownBudget.guardFlushMs,
    })
  }

  await closeAgentWorkerQueues()

  // 5. Close downstream dependencies.
  shutdownMemoryRetentionRollup()
  conversationAutoArchive.shutdown()
  shutdownStuckTurnProbe()
  try {
    await flushTraceWrites()
  } catch (error) {
    logError('backend.shutdown.trace_flush_failed', error)
  }
  await Promise.allSettled([shutdownPostHog(), shutdownJournalSealer(), closeRedis(), closeDb()])

  // 6. Flush + close OTel pipelines AFTER deps so any "db closing" /
  //    "redis quit" spans land before the exporter goes away.
  try {
    await shutdownTelemetry()
  } catch (err) {
    logError('backend.shutdown.telemetry_shutdown_failed', err)
  }

  process.exit(0)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig))
}

function getTlsOptions(): Bun.TLSOptions | undefined {
  const { tlsCertPath, tlsKeyPath } = config.server

  if (!tlsCertPath && !tlsKeyPath) return undefined
  if (!tlsCertPath || !tlsKeyPath) {
    throw new Error('Both ATLAS_DEV_TLS_CERT and ATLAS_DEV_TLS_KEY are required to enable HTTPS')
  }
  if (!existsSync(tlsCertPath)) throw new Error(`ATLAS_DEV_TLS_CERT not found: ${tlsCertPath}`)
  if (!existsSync(tlsKeyPath)) throw new Error(`ATLAS_DEV_TLS_KEY not found: ${tlsKeyPath}`)

  return {
    cert: Bun.file(tlsCertPath),
    key: Bun.file(tlsKeyPath),
  }
}
