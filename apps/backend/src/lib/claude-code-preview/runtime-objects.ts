import { createHash } from 'node:crypto'

import { runsBehindAcpShim, runtimeShortName } from './runtime-provider'

import type { OpenAbProvider } from './runtime-provider'

// Pure builders for a hosted runtime's Kubernetes objects. The provisioner
// applies these via server-side apply on every reconcile, so every field here
// is owned by it and template changes propagate to existing deployments.
export const PROVISIONER_FIELD_MANAGER = 'nuphos-provisioner'
export const RUNTIME_CONFIG_MAP = 'openab-runtime-config'
export const MCP_TOOL_TIMEOUT_MS = 30 * 60_000
// OpenAB ends an inner session idle this long (also its own default).
export const SESSION_TTL_HOURS = 4

export type KubeObject = {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  [key: string]: unknown
}

/** Deployment, Service and pod `app` label of the runtime Nuphos hosts for a row. */
export function hostedRuntimeName(
  teamId: string,
  provider: OpenAbProvider,
  runtimeId: string,
): string {
  const suffix = createHash('sha256').update(`${teamId}|${runtimeId}`).digest('hex').slice(0, 24)

  return `openab-${runtimeShortName(provider)}-${suffix}`
}

/** Claude Code keeps the ConfigMap name it had before there was a second provider. */
export function runtimeConfigMapName(provider: OpenAbProvider): string {
  return provider === 'claude-code'
    ? RUNTIME_CONFIG_MAP
    : `openab-${runtimeShortName(provider)}-config`
}

export function runtimeAuthSecretName(teamId: string, runtimeId: string): string {
  return `openab-runtime-${teamId}-${runtimeId}`
}

/** The home claim of the runtime whose Deployment/Service is `runtimeName`. */
export function runtimeHomeClaimName(runtimeName: string): string {
  return `${runtimeName}-home`
}

/** The workspace claim of the runtime whose Deployment/Service is `runtimeName`. */
export function runtimeWorkspaceClaimName(runtimeName: string): string {
  return `${runtimeName}-workspace`
}

/**
 * The runtime's two volumes, which both outlive its pod: home keeps the provider login
 * and native sessions, workspace keeps every conversation's files. Separate claims so a
 * build filling the workspace can never break a credential or session write.
 */
export function runtimeVolumeObjects(
  name: string,
  teamId: string,
  namespace: string,
): KubeObject[] {
  const claim = (claimName: string, storage: string): KubeObject => ({
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: claimName, namespace, labels: runtimeLabels(teamId) },
    spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage } } },
  })

  // ~/.claude, ~/.local and ~/.cache alone reach ~900Mi on a runtime that has
  // installed a few CLIs; checked-out repositories and build output go to the workspace.
  return [claim(runtimeHomeClaimName(name), '10Gi'), claim(runtimeWorkspaceClaimName(name), '20Gi')]
}

export function hostedRuntimeUrl(name: string, namespace: string): string {
  return `ws://${name}.${namespace}.svc:8080/acp`
}

export function runtimeLabels(teamId: string): Record<string, string> {
  return {
    'app.kubernetes.io/managed-by': PROVISIONER_FIELD_MANAGER,
    'nuphos.io/team-id': teamId,
  }
}

export function runtimeConfigMapObject(
  namespace: string,
  provider: OpenAbProvider = 'claude-code',
): KubeObject {
  // OpenAB clears the child environment. Set these on the agent, not just
  // the Pod, so native tools inherit them.
  //
  // Budget one tool well below the container limit instead of letting it use
  // most of it. The container holds up to `max_sessions` conversations; when
  // it runs out, the kernel kills only the largest process (the runtime node
  // pool sets kubelet singleProcessOOMKill), so a runaway tool fails on its own
  // and the pod survives. These budgets make that rarer: GOMEMLIMIT and the V8
  // old-space keep one tool small, and GOFLAGS/MAKEFLAGS keep build process
  // trees narrow, since N workers still add up to the container limit.
  // BASH_ENV sources runtime-guard.sh, which refreshes per-turn credentials.
  const memoryEnv =
    'GOMEMLIMIT = "1536MiB"\n' +
    'NODE_OPTIONS = "--max-old-space-size=1536"\n' +
    'GOFLAGS = "-p=2"\n' +
    'MAKEFLAGS = "-j2"\n' +
    'BASH_ENV = "/opt/nuphos-runtime/runtime-guard.sh"\n'

  // Concurrent ACP sessions per runtime pod. Above this, OpenAB suspends a
  // session to make room, and the user pays for it: the suspended conversation
  // has to replay its whole transcript through session/load on its next
  // message. At 4 a single person with a few conversations open thrashed the
  // pool -- one thread was suspended 25 times in a day on 2026-09-11.
  // Measured footprint is ~400 MiB per session (claude + the acp wrapper), so 8
  // sessions sit around 3.5 GiB of the pod's 8 GiB, still leaving room for the
  // one heavy tool the memory limits above are sized for.
  const poolConfig = `[pool]\nmax_sessions = 8\nsession_ttl_hours = ${String(SESSION_TTL_HOURS)}\n`

  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: runtimeConfigMapName(provider),
      namespace,
      labels: { 'app.kubernetes.io/managed-by': PROVISIONER_FIELD_MANAGER },
    },
    data: {
      'config.toml': runsBehindAcpShim(provider)
        ? `[agent]\ncommand = "node"\nargs = ["/opt/acp-shim.mjs", "${provider}"]\nworking_dir = "/workspace"\n\n` +
          `[agent.env]\n${memoryEnv}\n${poolConfig}`
        : provider === 'codex'
          ? `[agent]\ncommand = "codex-acp"\nworking_dir = "/workspace"\n\n` +
            // OpenAB applies [pool] default_config_options only after
            // session/new; codex-acp reads this on new, load and resume alike.
            `[agent.env]\nINITIAL_AGENT_MODE = "agent-full-access"\n${memoryEnv}\n${poolConfig}`
          : `[agent]\ncommand = "claude-agent-acp"\nworking_dir = "/workspace"\n\n` +
            // Decision tools block until a human answers; Claude Code's MCP call
            // timeout must outlast that. OpenAB env_clear()s the agent, so it
            // rides in [agent.env], not the container env.
            `[agent.env]\nMCP_TOOL_TIMEOUT = "${String(MCP_TOOL_TIMEOUT_MS)}"\nMCP_TIMEOUT = "30000"\n${memoryEnv}\n${
              poolConfig
            }`,
    },
  }
}

export function hostedRuntimeSecretObject(args: {
  teamId: string
  runtimeId: string
  namespace: string
  authKey: string
  /** Set once the runtime joins as a device; see runtime-device-join. */
  joinToken?: string
}): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: runtimeAuthSecretName(args.teamId, args.runtimeId),
      namespace: args.namespace,
      labels: { ...runtimeLabels(args.teamId), 'nuphos.io/runtime-id': args.runtimeId },
    },
    type: 'Opaque',
    stringData: {
      OPENAB_ACP_AUTH_KEY: args.authKey,
      ...(args.joinToken ? { NUPHOS_JOIN_TOKEN: args.joinToken } : {}),
    },
  }
}

export function hostedRuntimeServiceObject(
  name: string,
  teamId: string,
  namespace: string,
): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace, labels: runtimeLabels(teamId) },
    spec: {
      type: 'ClusterIP',
      selector: { app: name },
      ports: [{ port: 8080, targetPort: 8080 }],
      // One Recreate replica, so readiness chooses nothing; it only delayed the first
      // connection by the probe interval plus endpoint propagation.
      publishNotReadyAddresses: true,
    },
  }
}
