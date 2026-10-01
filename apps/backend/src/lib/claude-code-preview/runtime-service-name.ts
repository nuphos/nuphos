/** `ws://openab-team-abc.openab-runtimes.svc:8080/acp` → `openab-team-abc`,
 *  or null when the URL is not a Service in `namespace`. The Service shares
 *  its name with the runtime's Deployment and pod `app` label. */
export function runtimeServiceName(url: string, namespace: string): string | null {
  try {
    const host = new URL(url).hostname
    const match = /^([^.]+)\.([^.]+)\.svc(?:\.cluster\.local)?$/u.exec(host)

    return match?.[2] === namespace ? (match[1] ?? null) : null
  } catch {
    return null
  }
}
