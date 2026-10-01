// Classifies errors from the cluster-access probe. Only failures that show the
// API server was never reached justify masking every page. Errors arrive as
// strings because they crossed the Electron IPC boundary, which keeps the
// message but drops the class.

const FORBIDDEN_RE = /is forbidden|"reason"\s*:\s*"Forbidden"|HTTP-Code:\s*403/i

// `K8sTimeoutError` / "did not respond within" come from the main process's
// request deadline; the bare codes are Node's own DNS/connect/TLS failures.
const UNREACHABLE_RE =
  /K8sTimeoutError|did not respond within|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i

export function isForbiddenK8sError(message: string): boolean {
  return FORBIDDEN_RE.test(message)
}

export function isUnreachableK8sError(message: string): boolean {
  return UNREACHABLE_RE.test(message)
}

/** Pull the denied identity out of a k8s 403 body: `User "xxx" cannot list ...`. */
export function parseForbiddenSubject(message: string): string | null {
  const m = /User\s+\\*"([^"\\]+)\\*"/.exec(message)

  return m ? m[1] : null
}

export type ProbeVerdict =
  { state: 'ok' } | { state: 'denied'; subject: string | null } | { state: 'unreachable' }

/**
 * Turn a probe result into the mask to show.
 *
 * Note the fallback: a MIXED error set resolves to 'ok', deliberately, so the
 * individual views surface their own errors rather than hiding a partly-working
 * cluster behind one blanket mask. That fallback is also why a late result must
 * never be applied after the watchdog has already given up — it would replace an
 * accurate "unreachable" with empty views that look fine.
 */
export function classifyProbe(ok: boolean, errors: string[]): ProbeVerdict {
  if (ok) return { state: 'ok' }
  if (errors.length > 0 && errors.every(isUnreachableK8sError)) {
    return { state: 'unreachable' }
  }

  // Broad list probes cannot prove that an identity has no Kubernetes access.
  // A namespace-scoped identity may be allowed outside `default` while all
  // three probes return 403. Let the requested view show its precise RBAC error
  // instead of masking the entire cluster GUI.
  return { state: 'ok' }
}
