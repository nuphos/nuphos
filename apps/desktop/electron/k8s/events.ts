import { getClients, withAuthRetry } from './client'
import { ageOf } from './utils'

import type * as k8s from '@kubernetes/client-node'

export type EventRow = {
  // Stable identity for the row across watch deltas, scoped by the involved
  // object identity so detail views can distinguish same-kind custom resources.
  uid: string
  namespace: string
  kind: string
  name: string
  reason: string
  message: string
  count: number
  timestamp: string | null
  type_: string
}

export function eventRowKey(ev: k8s.CoreV1Event) {
  const involved = ev.involvedObject
  const involvedKey = involved?.uid
    ? `uid:${involved.uid}`
    : [
        'object',
        involved?.apiVersion ?? '',
        involved?.kind ?? '',
        involved?.namespace ?? ev.metadata?.namespace ?? '',
        involved?.name ?? '',
      ].join(':')
  const eventKey = ev.metadata?.uid ?? ev.metadata?.name ?? ''

  return eventKey ? `${involvedKey}:${eventKey}` : involvedKey
}

export function mapEventRow(ev: k8s.CoreV1Event): EventRow {
  const involved = ev.involvedObject

  return {
    uid: eventRowKey(ev),
    namespace: ev.metadata?.namespace ?? '',
    kind: involved?.kind ?? '',
    name: involved?.name ?? '',
    reason: ev.reason ?? '',
    message: ev.message ?? '',
    count: ev.count ?? 0,
    timestamp: ageOf(ev.lastTimestamp || ev.eventTime || ev.metadata?.creationTimestamp),
    type_: ev.type ?? '',
  }
}

export function listEvents(
  context: string,
  namespace: string | null,
  involvedKind: string | null,
  involvedName: string | null,
  involvedApiVersion: string | null = null,
  involvedUid: string | null = null,
  // Server-side `type` filter (e.g. "Warning"). Lets callers that only care
  // about warnings avoid pulling every event on a busy cluster.
  eventType: string | null = null,
) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const selectors: string[] = []

    if (eventType) selectors.push(`type=${eventType}`)
    if (involvedUid) selectors.push(`involvedObject.uid=${involvedUid}`)
    else if (involvedKind && involvedName) {
      selectors.push(`involvedObject.kind=${involvedKind}`, `involvedObject.name=${involvedName}`)
    }
    const fieldSelector = selectors.length ? selectors.join(',') : undefined
    const res = namespace
      ? await coreApi.listNamespacedEvent({ namespace, fieldSelector })
      : await coreApi.listEventForAllNamespaces({ fieldSelector })

    const items = res.items
      .filter((ev) => {
        const involved = ev.involvedObject

        if (involvedUid) return involved?.uid === involvedUid
        if (!involvedKind || !involvedName) return true
        if (involved?.kind !== involvedKind || involved?.name !== involvedName) return false
        if (involvedApiVersion) return involved.apiVersion === involvedApiVersion

        return true
      })
      .map(mapEventRow)

    items.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))

    return items
  })
}
