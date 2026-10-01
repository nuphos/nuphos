import {
  DEFAULT_AGENT_DRAIN_DEADLINE_MS,
  DEFAULT_LB_GRACE_MS,
  DEFAULT_TERMINATION_GRACE_SECONDS,
  resolveShutdownBudget,
} from '@/lib/shutdown-budget'

import { boundedInt, optional, optionalList } from './env'

function relayTokenSecret(): string | undefined {
  const secret = optional('NUPHOS_RELAY_TOKEN_SECRET')?.trim()

  if (!secret) return undefined
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('NUPHOS_RELAY_TOKEN_SECRET must be at least 32 bytes')
  }

  return secret
}

function downloadHandoffRateLimitSecret(): string | undefined {
  const secret = optional('DOWNLOAD_HANDOFF_RATE_LIMIT_SECRET')?.trim()

  if (!secret) return undefined
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('DOWNLOAD_HANDOFF_RATE_LIMIT_SECRET must be at least 32 bytes')
  }

  return secret
}

// How this replica reaches the rest of the cluster: the on-prem relay, the
// SIGTERM drain budget, and the shared redis.
export function platformConfig() {
  return {
    downloadHandoff: {
      // Shared only with the nuphos.ai server. It authenticates the landing
      // page's requests to the cross-replica email-handoff rate limiter.
      rateLimitSecret: downloadHandoffRateLimitSecret(),
    },
    // On-prem Kubernetes clusters reached through apps/kube-relay. All three are
    // needed for the feature to work; with any of them unset it stays dormant and
    // no on-prem cluster can be enrolled.
    relay: {
      // Shared HMAC secret for relay tokens — the SAME value the relay runs with
      // (NUPHOS_RELAY_TOKEN_SECRET there). Rotating it invalidates every enrolled
      // cluster's agent token at once. The relay refuses to start below 32 bytes,
      // so accepting a shorter one here would only move the failure to the far
      // side of a token nobody can verify.
      tokenSecret: relayTokenSecret(),
      // host:port customers' agent pods dial. Shown in the install manifest.
      agentEndpoint: optional('NUPHOS_RELAY_AGENT_ENDPOINT')?.trim() || undefined,
      // host:port of the relay's CONNECT proxy, used as a kubeconfig proxy-url.
      // No path: client-go rejects one.
      proxyEndpoint: optional('NUPHOS_RELAY_PROXY_ENDPOINT')?.trim() || undefined,
      // Authenticated status base URL. Production uses the proxy's public TLS
      // listener so backend replicas in either cluster query the same relay;
      // unset degrades "has the customer's pod connected" to unknown.
      statusUrl: optional('NUPHOS_RELAY_STATUS_URL')?.trim().replace(/\/$/, '') || undefined,
      // The agent image handed to customers. No default on purpose: the fallback
      // would be a mutable tag, and every manifest generated from it could quietly
      // start resolving to different agent code inside someone's cluster. An
      // unset value leaves the feature dormant like the rest of this section.
      agentImage: optional('NUPHOS_RELAY_AGENT_IMAGE')?.trim() || undefined,
    },
    shutdown: resolveShutdownBudget({
      // The pod's actual terminationGracePeriodSeconds, injected by the
      // Deployment manifest rather than by any checked-in env file, so it is
      // allowlisted in config.env-sync.test.ts rather than .env.example.
      terminationGraceMs:
        boundedInt('TERMINATION_GRACE_SECONDS', DEFAULT_TERMINATION_GRACE_SECONDS, {
          min: 1,
          max: 3_600,
        }) * 1_000,
      // Grace for k8s to deregister this pod (readiness → 503) before we stop accepting.
      lbGraceMs: boundedInt('AGENT_SHUTDOWN_LB_GRACE_MS', DEFAULT_LB_GRACE_MS, {
        min: 0,
        max: 60_000,
      }),
      // Requested wait for in-flight agent runs on SIGTERM; clamped down to
      // whatever the grace period can afford.
      agentDrainDeadlineMs: boundedInt(
        'AGENT_SHUTDOWN_DRAIN_DEADLINE_MS',
        DEFAULT_AGENT_DRAIN_DEADLINE_MS,
        { min: 0, max: 30 * 60 * 1_000 },
      ),
    }),
    redis: {
      enabled: optional('ATLAS_REDIS_ENABLED') === 'true',
      sentinels: optionalList('ATLAS_REDIS_SENTINELS'),
      masterName: process.env.ATLAS_REDIS_MASTER ?? 'mymaster',
      password: optional('REDIS_PASSWORD'),
      db: 0,
      opTimeoutMs: 500,
      // Off-cluster escape hatch: remap the in-cluster master DNS Sentinel
      // returns to a locally reachable host. Format: "host:port=host:port,..."
      // Empty in normal in-cluster runs.
      natMap: optionalList('ATLAS_REDIS_NAT_MAP'),
    },
  }
}
