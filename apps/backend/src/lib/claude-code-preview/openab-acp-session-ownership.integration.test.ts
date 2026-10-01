import { expect, test } from 'bun:test'

import { OpenAbAcpClient } from './openab-acp-client'

import type { AcpSocket } from './openab-acp-session'

type SocketEvent = { code?: number; data?: string; message?: string; reason?: string }
type SocketListener = (event: SocketEvent) => void
type RpcFrame = {
  id?: number
  method?: string
  params?: Record<string, unknown>
}

class OwnershipGatewaySocket implements AcpSocket {
  readonly protocol = 'acp.v1'
  readonly listeners = new Map<string, SocketListener[]>()
  readyState = 0

  constructor(
    private readonly gateway: OwnershipGateway,
    readonly generation: number,
  ) {
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? []

    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: SocketListener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    )
  }

  send(data: string) {
    this.gateway.receive(this, JSON.parse(data) as RpcFrame)
  }

  close() {
    this.readyState = 3
    this.emit('close', {})
  }

  deliver(frame: unknown) {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  private emit(type: string, event: SocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/**
 * Protocol-faithful OpenAB boundary for the ownership behavior under test.
 * An idle route may move between live connections, while an active prompt is
 * an exclusive claim that another connection cannot replace.
 */
class OwnershipGateway {
  readonly acceptedPrompts: string[] = []
  private nextConnectionGeneration = 0
  private nextSessionId = 0
  private readonly ownerGenerationBySession = new Map<string, number>()
  private readonly activeSessions = new Set<string>()
  private holdNext = false
  private heldPrompt: { id: number; sessionId: string; socket: OwnershipGatewaySocket } | undefined
  private onPromptHeld: (() => void) | undefined

  readonly socketFactory = () => {
    return new OwnershipGatewaySocket(this, ++this.nextConnectionGeneration)
  }

  holdNextPrompt() {
    this.holdNext = true

    return new Promise<void>((resolve) => {
      this.onPromptHeld = resolve
    })
  }

  releaseHeldPrompt() {
    const held = this.heldPrompt

    if (!held) throw new Error('No prompt is held')
    this.heldPrompt = undefined
    this.activeSessions.delete(held.sessionId)
    this.success(held.socket, held.id, { stopReason: 'end_turn' })
  }

  receive(socket: OwnershipGatewaySocket, frame: RpcFrame) {
    if (frame.method === 'session/cancel' || typeof frame.id !== 'number') return

    if (frame.method === 'initialize') {
      this.success(socket, frame.id, {
        protocolVersion: 1,
        agentCapabilities: {
          _meta: { 'dev.openab/permissionRelay': true, 'dev.openab/sessionAuthority': 2 },
        },
      })

      return
    }

    if (frame.method === 'session/new') {
      const sessionId = `sess_${String(++this.nextSessionId)}`

      this.ownerGenerationBySession.set(sessionId, socket.generation)
      this.success(socket, frame.id, { sessionId })

      return
    }

    const sessionId = frame.params?.sessionId

    if (typeof sessionId !== 'string' || !this.ownerGenerationBySession.has(sessionId)) {
      this.error(socket, frame.id, -32602, 'Unknown session')

      return
    }

    if (frame.method === 'session/resume') {
      if (!this.activeSessions.has(sessionId)) {
        this.ownerGenerationBySession.set(sessionId, socket.generation)
      }
      this.success(socket, frame.id, {})

      return
    }

    if (frame.method !== 'session/prompt') {
      this.error(socket, frame.id, -32601, 'Method not found')

      return
    }

    if (this.activeSessions.has(sessionId)) {
      this.error(socket, frame.id, -32603, 'ACP session output sink is unavailable')

      return
    }

    const text = this.promptText(frame.params?.prompt)

    this.ownerGenerationBySession.set(sessionId, socket.generation)
    this.activeSessions.add(sessionId)
    this.acceptedPrompts.push(text)
    socket.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `reply:${text}` },
        },
      },
    })
    if (this.holdNext) {
      this.holdNext = false
      this.heldPrompt = { id: frame.id, sessionId, socket }
      this.onPromptHeld?.()
      this.onPromptHeld = undefined

      return
    }

    this.activeSessions.delete(sessionId)
    this.success(socket, frame.id, { stopReason: 'end_turn' })
  }

  private promptText(value: unknown): string {
    if (!Array.isArray(value)) return ''
    const first = value[0]

    if (!first || typeof first !== 'object') return ''
    const text = (first as Record<string, unknown>).text

    return typeof text === 'string' ? text : ''
  }

  private success(socket: OwnershipGatewaySocket, id: number, result: Record<string, unknown>) {
    socket.deliver({ jsonrpc: '2.0', id, result })
  }

  private error(socket: OwnershipGatewaySocket, id: number, code: number, message: string) {
    socket.deliver({ jsonrpc: '2.0', id, error: { code, message } })
  }
}

async function createHarness() {
  const gateway = new OwnershipGateway()
  const endpoint = { url: 'wss://openab.example/acp', authKey: 'test-key' }
  const connect = () =>
    OpenAbAcpClient.connect({ ...endpoint, socketFactory: gateway.socketFactory })
  const replicaA = await connect()
  const replicaB = await connect()
  const sessionId = await replicaA.createSession('/workspace', [])
  const replies: string[] = []
  const run = (client: OpenAbAcpClient, message: string) =>
    client.prompt(sessionId, message, (text) => replies.push(text))

  return { gateway, replicaA, replicaB, replies, run, sessionId }
}

test('a conversation completes exactly once when turns move A → B → A', async () => {
  const { gateway, replicaA, replicaB, replies, run, sessionId } = await createHarness()

  expect(await run(replicaA, 'turn-1')).toEqual({ stopReason: 'end_turn' })
  await replicaB.loadSession(sessionId, '/workspace', [])
  expect(await run(replicaB, 'turn-2')).toEqual({ stopReason: 'end_turn' })
  expect(await run(replicaA, 'turn-3')).toEqual({ stopReason: 'end_turn' })

  expect(replies).toEqual(['reply:turn-1', 'reply:turn-2', 'reply:turn-3'])
  expect(gateway.acceptedPrompts).toEqual(['turn-1', 'turn-2', 'turn-3'])
})

test('a second replica cannot dispatch while the first replica owns an active turn', async () => {
  const { gateway, replicaA, replicaB, replies, run, sessionId } = await createHarness()

  expect(await run(replicaA, 'setup')).toEqual({ stopReason: 'end_turn' })
  const promptHeld = gateway.holdNextPrompt()
  const activeTurn = run(replicaA, 'active-turn')

  await promptHeld
  await replicaB.loadSession(sessionId, '/workspace', [])
  await expect(run(replicaB, 'competing-turn')).rejects.toThrow(
    'ACP session output sink is unavailable',
  )
  gateway.releaseHeldPrompt()

  expect(await activeTurn).toEqual({ stopReason: 'end_turn' })
  expect(replies).toEqual(['reply:setup', 'reply:active-turn'])
  expect(gateway.acceptedPrompts).toEqual(['setup', 'active-turn'])
})
