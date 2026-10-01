/*
 * Delivery of deep-link payloads from main to whichever renderer is listening.
 *
 * A deep link arrives whenever the OS feels like it: before the app is ready,
 * mid-paint, on the login screen, or with the workspace mounted. The renderer
 * attaches its listeners from a React effect long after did-finish-load, so
 * main can never assume anyone is on the other end of `webContents.send`.
 *
 * Delivery therefore runs on the renderer's ack rather than on main's guess
 * about who is ready: a payload stays queued and is re-sent on a backing-off
 * timer until the preload acks it, which only happens once a handler has it.
 * Missing the window — none open, still loading, no listener yet — costs a
 * retry interval rather than the payload.
 */

export type DeepLinkEnvelope = {
  deliveryId: number
  payload: unknown
}

export type DeepLinkTarget = {
  isLoading: () => boolean
  send: (channel: string, envelope: DeepLinkEnvelope) => void
}

const FIRST_RETRY_MS = 400
const MAX_RETRY_MS = 5_000

/**
 * How long a payload keeps looking for a listener. Generous on purpose: a deep
 * link that cold-starts the app has to survive the whole sign-in flow. Past
 * this the link is stale enough that navigating would surprise the user more
 * than dropping it.
 */
export const DEEP_LINK_EXPIRY_MS = 10 * 60_000

type PendingDelivery = {
  deliveryId: number
  channel: string
  payload: unknown
  queuedAt: number
}

export function createDeepLinkDelivery(resolveTarget: () => DeepLinkTarget | null) {
  const pending: PendingDelivery[] = []
  let nextDeliveryId = 1
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelayMs = FIRST_RETRY_MS

  function cancelRetry() {
    if (!retryTimer) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  function dropExpired() {
    const cutoff = Date.now() - DEEP_LINK_EXPIRY_MS
    const live = pending.filter((item) => item.queuedAt > cutoff)

    if (live.length !== pending.length) pending.splice(0, pending.length, ...live)
  }

  // The ack rides back over IPC, so the queue is still full right after the
  // sends below — a retry is always armed and then cancelled by the ack a
  // moment later. Re-sends are safe: the preload drops deliveryIds it has
  // already handed to the renderer.
  function attempt(preferred?: DeepLinkTarget | null) {
    cancelRetry()
    dropExpired()
    if (pending.length === 0) {
      retryDelayMs = FIRST_RETRY_MS

      return
    }

    const target = preferred ?? resolveTarget()

    // Snapshot first: an ack can land while this loop runs and splice `pending`.
    const batch = pending.slice()

    if (target && !target.isLoading()) {
      for (const item of batch) {
        target.send(item.channel, { deliveryId: item.deliveryId, payload: item.payload })
      }
    }
    if (pending.length === 0) {
      retryDelayMs = FIRST_RETRY_MS

      return
    }
    retryTimer = setTimeout(() => attempt(), retryDelayMs)
    retryTimer.unref()
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS)
  }

  return {
    /** Queue a payload and try to hand it over right away. */
    enqueue(channel: string, payload: unknown, preferred?: DeepLinkTarget | null) {
      pending.push({
        deliveryId: nextDeliveryId,
        channel,
        payload,
        queuedAt: Date.now(),
      })
      nextDeliveryId += 1
      attempt(preferred)
    },

    /** Re-attempt now — a window finished loading, focused, or subscribed. */
    flush(preferred?: DeepLinkTarget | null) {
      if (pending.length === 0) return
      retryDelayMs = FIRST_RETRY_MS
      attempt(preferred)
    },

    /** The renderer received this payload; stop re-sending it. */
    ack(deliveryId: unknown) {
      const index = pending.findIndex((item) => item.deliveryId === deliveryId)

      if (index === -1) return
      pending.splice(index, 1)
      if (pending.length === 0) {
        cancelRetry()
        retryDelayMs = FIRST_RETRY_MS
      }
    },

    pendingCount: () => pending.length,
  }
}

export type DeepLinkDelivery = ReturnType<typeof createDeepLinkDelivery>
