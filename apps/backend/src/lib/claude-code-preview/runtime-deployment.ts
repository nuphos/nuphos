import {
  runtimeAuthSecretName,
  runtimeHomeClaimName,
  runtimeWorkspaceClaimName,
  runtimeLabels as labels,
  runtimeConfigMapName,
} from './runtime-objects'

import type { KubeObject } from './runtime-objects'
import type { OpenAbProvider } from './runtime-provider'

export type RuntimeScheduling = {
  /** Node labels a runtime pod requires. Empty schedules it on any node. */
  nodeSelector: Record<string, string>
  /** `key=value` taints the pod tolerates with `NoSchedule`. */
  tolerations: { key: string; value: string }[]
  /** CPU limit for the agent container. Unset leaves it unbounded. */
  cpuLimit?: string
}

export const DEFAULT_RUNTIME_SCHEDULING: RuntimeScheduling = {
  nodeSelector: {},
  tolerations: [],
}

export function hostedRuntimeDeploymentObject(args: {
  name: string
  teamId: string
  runtimeId: string
  namespace: string
  image: string
  provider: OpenAbProvider
  /** A disabled runtime keeps its volumes but runs no pod. */
  running: boolean
  scheduling?: RuntimeScheduling
}): KubeObject {
  const { name } = args
  const secretName = runtimeAuthSecretName(args.teamId, args.runtimeId)
  const scheduling = args.scheduling ?? DEFAULT_RUNTIME_SCHEDULING

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: args.namespace, labels: labels(args.teamId) },
    spec: {
      replicas: args.running ? 1 : 0,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name, ...labels(args.teamId) } },
        spec: {
          automountServiceAccountToken: false,
          // Both stay absent unless the cluster actually has the isolated pool,
          // so a cluster without it schedules runtimes on any node.
          ...(Object.keys(scheduling.nodeSelector).length > 0
            ? { nodeSelector: scheduling.nodeSelector }
            : {}),
          ...(scheduling.tolerations.length > 0
            ? {
                tolerations: scheduling.tolerations.map(({ key, value }) => ({
                  key,
                  operator: 'Equal',
                  value,
                  effect: 'NoSchedule',
                })),
              }
            : {}),
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: 'openab',
              image: args.image,
              ports: [{ containerPort: 8080 }],
              env: [
                {
                  name: 'OPENAB_ACP_AUTH_KEY',
                  valueFrom: { secretKeyRef: { name: secretName, key: 'OPENAB_ACP_AUTH_KEY' } },
                },
                { name: 'OPENAB_RUNTIME_CONSOLE', value: 'false' },
                { name: 'OPENAB_STREAM_EDIT_INTERVAL_MS', value: '300' },
                {
                  name: 'RUST_LOG',
                  // The ACP prompt/permission/dispatch seams only explain their
                  // failure modes (stale-sink takeover, dropped replies) at
                  // debug; everything else stays at info.
                  value:
                    'info,openab_gateway::adapters::acp_server=debug,' +
                    'openab_core::dispatch=debug,openab_core::acp=debug,' +
                    'openab_core::adapter=debug',
                },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [
                { name: 'home', mountPath: '/home/node' },
                { name: 'workspace', mountPath: '/workspace' },
                { name: 'config', mountPath: '/etc/openab', readOnly: true },
              ],
              resources: {
                // A runtime pools up to `max_sessions` conversations and each
                // costs ~400 MiB (an ACP bridge plus a native agent process),
                // so a busy pod's idle floor runs to gigabytes and 512Mi made
                // the scheduler pack nodes as if these pods were a fraction of
                // their real size. Kept at 1Gi rather than that floor: the
                // default pool has ~13 GiB allocatable per node and already
                // runs several runtimes per node, and an unschedulable runtime
                // is worse than a tight one (the Deployment is Recreate, so
                // its pod would stay Pending).
                requests: { cpu: '250m', memory: '1Gi' },
                limits: {
                  memory: '8Gi',
                  ...(scheduling.cpuLimit ? { cpu: scheduling.cpuLimit } : {}),
                },
              },
              readinessProbe: {
                httpGet: { path: '/health', port: 8080 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: { path: '/health', port: 8080 },
                initialDelaySeconds: 15,
                periodSeconds: 30,
              },
            },
          ],
          volumes: [
            { name: 'home', persistentVolumeClaim: { claimName: runtimeHomeClaimName(name) } },
            {
              name: 'workspace',
              persistentVolumeClaim: { claimName: runtimeWorkspaceClaimName(name) },
            },
            {
              name: 'config',
              configMap: {
                name: runtimeConfigMapName(args.provider),
              },
            },
          ],
        },
      },
    },
  }
}
