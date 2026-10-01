import { randomUUID } from 'node:crypto'
import net from 'node:net'

import * as k8s from '@kubernetes/client-node'

import { getClients, withAuthRetry } from './client'
import { isReadyPod, resolveNamedPodPort, serviceSelectorString } from './port-forward-options'
import {
  activeForwarders,
  broadcastPfEvent,
  createSocketWriter,
  safeDestroySocket,
} from './port-forward-shared'

import type { PortForwardInfo, PortForwardWebSocket } from './port-forward-shared'
import type { Writable } from 'node:stream'

export async function startPortForward(
  context: string,
  namespace: string,
  podName: string,
  targetPort: number,
  localPort = 0,
): Promise<PortForwardInfo> {
  const { kc } = getClients(context)
  const id = randomUUID()

  return new Promise((resolve, reject) => {
    let started = false
    let activeInfo: PortForwardInfo | null = null
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      const forward = new k8s.PortForward(kc)
      let websocket: PortForwardWebSocket | null = null
      let closeUpstream: (() => void) | null = null
      let output: Writable | null = null
      let closed = false
      const closeWebSocket = () => {
        if (!closeUpstream) return
        try {
          closeUpstream()
        } catch {
          // Ignore close races between the local socket and upstream websocket.
        }
        closeUpstream = null
        websocket = null
      }
      const closeLocalSocket = () => {
        safeDestroySocket(socket)
      }
      const closeLocalPipe = () => {
        closed = true
        sockets.delete(socket)
        closeWebSocket()
        output?.destroy()
        output = null
      }

      socket.on('close', () => {
        closeLocalPipe()
      })
      socket.on('error', () => {
        closeLocalPipe()
      })
      output = createSocketWriter(socket, () => {
        closeLocalPipe()
        closeLocalSocket()
      })
      forward
        .portForward(namespace, podName, [targetPort], output, null, socket)
        .then((ws) => {
          if (typeof ws === 'function') {
            closeUpstream = ws
          } else {
            websocket = ws as PortForwardWebSocket
            closeUpstream = () => websocket?.close()
          }
          if (closed || socket.destroyed) {
            closeWebSocket()

            return
          }
          websocket?.on('close', closeLocalSocket)
          websocket?.on('error', closeLocalSocket)
        })
        .catch((err: unknown) => {
          console.error(
            `[k8s] port-forward error (${namespace}/${podName}:${String(targetPort)}):`,
            err,
          )
          socket.destroy()
        })
    })

    server.listen(localPort, '127.0.0.1', () => {
      started = true
      const addr = server.address() as net.AddressInfo
      const info: PortForwardInfo = {
        id,
        context,
        namespace,
        podName,
        targetPort,
        localPort: addr.port,
        startedAt: new Date().toISOString(),
      }

      activeInfo = info
      activeForwarders.set(id, { server, info, sockets, closing: false })
      broadcastPfEvent('started', info)
      resolve(info)
    })
    server.on('error', (err) => {
      if (!started) {
        activeForwarders.delete(id)
        reject(err)
      } else if (activeInfo) {
        broadcastPfEvent('error', activeInfo, err.message)
        closePortForward(id)
      }
    })
  })
}

export function startServicePortForward(
  context: string,
  namespace: string,
  serviceName: string,
  servicePort: number,
  localPort = 0,
): Promise<PortForwardInfo> {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)
    const service = await coreApi.readNamespacedService({ namespace, name: serviceName })
    const port = (service.spec?.ports ?? []).find(
      (candidate) =>
        candidate.port === servicePort && (!candidate.protocol || candidate.protocol === 'TCP'),
    )

    if (!port) {
      throw new Error(`Service "${serviceName}" does not expose TCP port ${String(servicePort)}.`)
    }

    const selector = serviceSelectorString(service)

    if (!selector) {
      throw new Error(`Service "${serviceName}" has no selector to resolve a target pod.`)
    }

    const pods = await coreApi.listNamespacedPod({ namespace, labelSelector: selector })
    const pod = pods.items.find(isReadyPod) ?? pods.items[0]

    if (!pod) {
      throw new Error(`Service "${serviceName}" has no matching pods.`)
    }

    const targetPort = port.targetPort ?? port.port
    let podPort: number

    if (typeof targetPort === 'number') {
      podPort = targetPort
    } else {
      const namedPort = resolveNamedPodPort(pod, targetPort)

      if (!namedPort) {
        throw new Error(
          `Service "${serviceName}" targets port "${targetPort}", but no matching pod port was found.`,
        )
      }
      podPort = namedPort
    }

    const podName = pod.metadata?.name

    if (!podName) {
      throw new Error(`Service "${serviceName}" resolved to a pod without a name.`)
    }

    return startPortForward(context, namespace, podName, podPort, localPort)
  })
}

function closePortForward(id: string): void {
  const entry = activeForwarders.get(id)

  if (!entry) return
  if (entry.closing) return
  entry.closing = true
  entry.server.close(() => {
    activeForwarders.delete(id)
    broadcastPfEvent('stopped', entry.info)
  })
  for (const socket of entry.sockets) {
    socket.destroy()
  }
}

export function stopPortForward(id: string): void {
  closePortForward(id)
}

export function stopAllPortForwards(): void {
  for (const id of activeForwarders.keys()) {
    stopPortForward(id)
  }
}

export function listPortForwards(): PortForwardInfo[] {
  return [...activeForwarders.values()].map((e) => e.info)
}
