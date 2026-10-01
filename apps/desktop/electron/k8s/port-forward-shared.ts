import { Writable } from 'node:stream'

import { BrowserWindow } from 'electron'

import type net from 'node:net'

export type PortForwardInfo = {
  id: string
  // kubeconfig context the forward is bound to. Needed so the agent (and the
  // bottom bar in multi-cluster sessions) can distinguish forwards across
  // contexts; previously the type didn't surface this, but each forward is
  // already created against a specific context's clients.
  context: string
  namespace: string
  podName: string
  targetPort: number
  localPort: number
  startedAt: string
}

export type ActiveForwarder = {
  server: net.Server
  info: PortForwardInfo
  sockets: Set<net.Socket>
  closing: boolean
}

export type PortForwardWebSocket = {
  close: () => void
  on: (event: 'close' | 'error', listener: () => void) => void
}

export type PortForwardPort = {
  name?: string
  port: number
  protocol?: string
}

export const activeForwarders = new Map<string, ActiveForwarder>()

export function safeDestroySocket(socket: net.Socket): void {
  if (!socket.destroyed) socket.destroy()
}

export function createSocketWriter(socket: net.Socket, onError: (err: unknown) => void): Writable {
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      if (socket.destroyed || !socket.writable) {
        callback()

        return
      }
      try {
        socket.write(chunk)
        callback()
      } catch (err) {
        onError(err)
        callback()
      }
    },
    final(callback) {
      if (!socket.destroyed) socket.end()
      callback()
    },
  })

  writer.on('error', onError)

  return writer
}

export function broadcastPfEvent(
  type: 'started' | 'stopped' | 'error',
  info: PortForwardInfo,
  error?: string,
) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed())
      win.webContents.send('k8s:portforward:event', { type, info, error })
  }
}
