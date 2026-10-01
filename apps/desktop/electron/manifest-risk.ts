import yaml from 'js-yaml'

// Pure, dependency-light risk classifier for an applied manifest. Kept free of
// any `electron` import so it can be unit-tested directly (see
// manifest-risk.test.ts). consent.ts re-exports `dangerousManifestReason`.
//
// "Dangerous" = grants node/cluster-level power, so the apply warrants native
// consent. Best-effort: unparseable/odd input returns null —
// applyResourceYaml does the authoritative validation, this only gates.

const RBAC_KINDS = new Set(['ClusterRole', 'ClusterRoleBinding', 'Role', 'RoleBinding'])

type LooseRecord = Record<string, unknown>

function asRecord(v: unknown): LooseRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as LooseRecord) : null
}

// Every place a PodSpec can hide across the kinds Nuphos can apply:
//   Pod                                   -> spec
//   Deployment/StatefulSet/DaemonSet/
//   ReplicaSet/Job/ReplicationController   -> spec.template.spec
//   CronJob                               -> spec.jobTemplate.spec.template.spec
// We probe ALL of them regardless of the declared `kind` so a mislabeled or
// double-nested manifest (e.g. a CronJob) can't smuggle a privileged PodSpec
// past the gate.
function candidatePodSpecs(kind: string, spec: LooseRecord | null): LooseRecord[] {
  if (!spec) return []
  const out: LooseRecord[] = []

  if (kind === 'Pod') {
    out.push(spec)
  }
  const templateSpec = asRecord(asRecord(spec.template)?.spec)

  if (templateSpec) out.push(templateSpec)
  const cronSpec = asRecord(asRecord(asRecord(asRecord(spec.jobTemplate)?.spec)?.template)?.spec)

  if (cronSpec) out.push(cronSpec)

  return out
}

function podSpecRisk(podSpec: LooseRecord): string | null {
  if (podSpec.hostPID === true || podSpec.hostNetwork === true || podSpec.hostIPC === true) {
    return 'runs in a host namespace (hostPID / hostNetwork / hostIPC)'
  }

  const containers = [
    ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
    ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ...(Array.isArray(podSpec.ephemeralContainers) ? podSpec.ephemeralContainers : []),
  ]

  for (const c of containers) {
    const sc = asRecord(asRecord(c)?.securityContext)

    if (sc?.privileged === true) return 'runs a privileged container'
  }

  if (Array.isArray(podSpec.volumes) && podSpec.volumes.some((v) => asRecord(v)?.hostPath)) {
    return 'mounts a host path from the node'
  }

  return null
}

// Returns a short human reason when a manifest grants node/cluster-level power,
// or null for an ordinary object that should apply without a prompt.
export function dangerousManifestReason(yamlText: string): string | null {
  let doc: unknown

  try {
    doc = yaml.load(yamlText)
  } catch {
    return null
  }
  const root = asRecord(doc)

  if (!root) return null

  const kind = typeof root.kind === 'string' ? root.kind : ''

  if (RBAC_KINDS.has(kind)) {
    // Role / RoleBinding are namespace-scoped; only the Cluster* kinds grant
    // cluster-wide permissions. Either way it warrants consent.
    const scope = kind.startsWith('Cluster') ? 'cluster' : 'namespace'

    return `applies a ${kind}, which can grant ${scope} permissions`
  }

  for (const podSpec of candidatePodSpecs(kind, asRecord(root.spec))) {
    const reason = podSpecRisk(podSpec)

    if (reason) return reason
  }

  return null
}
