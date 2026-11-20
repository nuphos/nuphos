// A Box's whole desktop, streamed to whoever manages the Box: instabox carries its
// VNC over GET /v1/machines/{id}/vnc with the account's key, which works for a
// workspace key (desktop links do not: instabox makes those only for the machine's
// creator). The viewer speaks the same frames as a conversation's desktop
// (runtime-desktop.ts): RFB bytes as base64 text, so the Desktop's noVNC reads both.

import type { WSEvents } from 'hono/ws'

export type BoxVncUpstream = { url: string; headers: Record<string, string> }

/** A client-to-server RFB message in base64 (a few bytes; a clipboard paste at most). */
const MAX_FRAME_CHARS = 64 * 1024

const dialInstabox = (url: string, headers: Record<string, string>) =>
  // Bun's WebSocket takes headers; the key never goes in the URL.
  new WebSocket(url, { headers } as unknown as string[])

export function boxVncRelay(upstream: BoxVncUpstream, dial = dialInstabox): WSEvents {
  let remote: WebSocket | undefined

  return {
    onOpen(_event, ws) {
      remote = dial(upstream.url, upstream.headers)
      remote.binaryType = 'arraybuffer'
      remote.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data !== 'string')
          ws.send(Buffer.from(event.data as ArrayBuffer).toString('base64'))
      })
      remote.addEventListener('close', () => {
        ws.close()
      })
      remote.addEventListener('error', () => {
        ws.close()
      })
    },
    onMessage(event) {
      const data = event.data

      // A control frame (`{"t":"control"}`) has nothing to hold here: the Box's whole
      // desktop is not one an agent's input tools lock.
      if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS || data.startsWith('{')) return
      if (remote?.readyState === WebSocket.OPEN) remote.send(Buffer.from(data, 'base64'))
    },
    onClose() {
      remote?.close()
    },
  }
}
