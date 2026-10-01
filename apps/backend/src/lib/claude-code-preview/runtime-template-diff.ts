import { quantityValue } from './kube-quantity'

// Fields the API server fills in itself, so a live pod spec carries them even
// though the provisioner never sends them. Anything else the live object has
// and the desired one does not is a field the provisioner dropped, which
// server-side apply would remove from the running pod.
const SERVER_DEFAULT_FIELDS = new Set([
  'creationTimestamp',
  'defaultMode',
  'deprecatedServiceAccount',
  'dnsPolicy',
  'enableServiceLinks',
  'failureThreshold',
  'imagePullPolicy',
  'preemptionPolicy',
  'priority',
  'protocol',
  'restartPolicy',
  'schedulerName',
  'scheme',
  'serviceAccount',
  'serviceAccountName',
  'successThreshold',
  'terminationGracePeriodSeconds',
  'terminationMessagePath',
  'terminationMessagePolicy',
  'timeoutSeconds',
  'tolerationSeconds',
])

// The API server inserts these empty rather than filled, so a live-only one
// is a default only while it is still empty — dropping a populated security
// context or resource block is a real change to the pod.
const SERVER_DEFAULT_EMPTY_FIELDS = new Set(['resources', 'securityContext'])

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// "4" and "4000m" are the same limit; the API server stores its own canonical
// spelling of whatever was applied.
function sameQuantity(desired: string, live: unknown): boolean {
  if (typeof live !== 'string') return false
  const [desiredValue, liveValue] = [quantityValue(desired), quantityValue(live)]

  return desiredValue === null || liveValue === null ? desired === live : desiredValue === liveValue
}

function sameValue(desired: unknown, live: unknown, quantities: boolean): boolean {
  if (Array.isArray(desired))
    return (
      Array.isArray(live) &&
      desired.length === live.length &&
      desired.every((entry, index) => sameValue(entry, live[index], quantities))
    )
  if (isObject(desired)) return isObject(live) && sameObject(desired, live, quantities)
  if (quantities && typeof desired === 'string') return sameQuantity(desired, live)

  return desired === live
}

function isServerDefault(key: string, value: unknown): boolean {
  if (SERVER_DEFAULT_FIELDS.has(key)) return true

  return SERVER_DEFAULT_EMPTY_FIELDS.has(key) && isObject(value) && Object.keys(value).length === 0
}

function sameObject(desired: JsonObject, live: JsonObject, quantities: boolean): boolean {
  if (
    Object.entries(live).some(([key, value]) => !(key in desired) && !isServerDefault(key, value))
  )
    return false

  return Object.entries(desired).every(([key, value]) =>
    sameValue(value, live[key], quantities || key === 'resources'),
  )
}

function templateLabels(template: JsonObject): unknown {
  const metadata = template.metadata

  return isObject(metadata) ? (metadata.labels ?? {}) : {}
}

/**
 * Whether applying `desired` would recreate the pod.
 *
 * Errs towards "changed": an unrecognised server default only costs a deferred
 * rollout, while missing a real difference restarts a pod mid-turn. Template
 * annotations are left out — anything may add one to a live Deployment, and
 * the ones the provisioner owns are checked by its caller.
 */
export function podTemplateChanged(desired: unknown, live: unknown): boolean {
  if (!isObject(desired) || !isObject(live)) return true

  return (
    !sameValue(desired.spec, live.spec, false) ||
    !sameValue(templateLabels(desired), templateLabels(live), false)
  )
}
