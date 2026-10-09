import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { LocalTerminalSessions, terminalSize } from './local-terminal.ts'

import type { LocalTerminalEvent } from '../src/api/local-terminal-types.ts'
import type { WebContents } from 'electron'

function renderer() {
  const events: LocalTerminalEvent[] = []
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (_channel: string, event: LocalTerminalEvent) => {
      events.push(event)
      owner.emit('terminal-event', event)
    },
  })

  return { owner: owner as unknown as WebContents, emitter: owner, events }
}

function waitForOutput(emitter: EventEmitter, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      emitter.off('terminal-event', onEvent)
      reject(new Error(`Terminal output did not contain expected marker: ${expected}`))
    }, 10_000)
    const onEvent = (event: LocalTerminalEvent) => {
      if (event.type !== 'data') return
      output += event.data
      if (!output.includes(expected)) return
      clearTimeout(timer)
      emitter.off('terminal-event', onEvent)
      resolve()
    }

    emitter.on('terminal-event', onEvent)
  })
}

test('terminal dimensions remain valid for hidden panes and malformed input', () => {
  assert.equal(terminalSize(0, 80), 2)
  assert.equal(terminalSize(Number.NaN, 80), 80)
  assert.equal(terminalSize(9000, 80), 500)
  assert.equal(terminalSize(90.9, 80), 90)
})

test(
  'local shell has a real TTY, resizes, handles Ctrl+C and closes on renderer teardown',
  { timeout: 20_000, skip: process.platform === 'win32' },
  async () => {
    const sessions = new LocalTerminalSessions()
    const { owner, emitter, events } = renderer()

    try {
      const id = 'tab-1'

      sessions.start(owner, id, 80, 24)
      sessions.replay(owner, id)
      const ttyReady = waitForOutput(emitter, 'NUPHOS_PTY_OK')

      sessions.input(owner, id, "test -t 0 && printf '%s%s\\n' NUPHOS_ PTY_OK\r")
      await ttyReady
      sessions.resize(owner, id, 101, 37)
      const resized = waitForOutput(emitter, '37 101')

      sessions.input(owner, id, 'stty size\r')
      await resized
      sessions.input(owner, id, 'sleep 30\r')
      await new Promise((resolve) => setTimeout(resolve, 100))
      sessions.input(owner, id, '\x03')
      const interrupted = waitForOutput(emitter, 'NUPHOS_INTERRUPT_OK')

      sessions.input(owner, id, "printf '%s%s\\n' NUPHOS_ INTERRUPT_OK\r")
      await interrupted
      assert.ok(events.some((event) => event.type === 'data'))
      emitter.emit('destroyed')
      assert.throws(() => sessions.input(owner, id, 'echo should-not-run\r'), /not available/)
    } finally {
      sessions.closeAll()
    }
  },
)

test(
  'a remounted view reattaches to the tab’s shell and replays what it missed',
  { timeout: 20_000, skip: process.platform === 'win32' },
  async () => {
    const sessions = new LocalTerminalSessions()
    const { owner, emitter, events } = renderer()
    const id = 'tab-1'

    try {
      const first = sessions.start(owner, id, 80, 24)
      const moved = waitForOutput(emitter, 'NUPHOS_MOVED_OK')

      // Leave a mark the shell itself carries. Deliberately `cd` rather than a
      // variable: the assignment syntax differs between shells and this spawns
      // whatever login shell the developer actually uses, so a fish user would
      // watch this fail for reasons that have nothing to do with the terminal.
      sessions.input(owner, id, "cd /usr/lib; printf '%s%s\\n' NUPHOS_ MOVED_OK\r")
      await moved

      // Switching chat session unmounts the view and mounts it again. Same tab
      // id, so the shell must be the one already running — not a new one.
      const sent = events.length
      const again = sessions.start(owner, id, 80, 24)

      assert.equal(again.shell, first.shell)
      sessions.replay(owner, id)
      const replayed = events
        .slice(sent)
        .map((event) => (event.type === 'data' ? event.data : ''))
        .join('')

      assert.match(replayed, /NUPHOS_MOVED_OK/)
      const stillThere = waitForOutput(emitter, '/usr/lib')

      // A shell that had been restarted would answer with the home directory
      // the pty is spawned in, so only the original process says /usr/lib.
      sessions.input(owner, id, 'pwd\r')
      await stillThere
    } finally {
      sessions.closeAll()
    }
  },
)

test('sessions reject another window and cleanup on reload', async () => {
  const sessions = new LocalTerminalSessions()
  const first = renderer()
  const other = renderer()

  try {
    const id = 'tab-1'

    sessions.start(first.owner, id, 80, 24)
    if (process.platform !== 'win32') {
      const ready = waitForOutput(first.emitter, 'RELOAD_SHELL_READY')

      sessions.input(first.owner, id, "printf '%s%s\\n' RELOAD_SHELL_ READY\r")
      await ready
    }

    assert.throws(() => sessions.replay(other.owner, id), /not available/)
    assert.throws(() => sessions.start(other.owner, id, 80, 24), /not available/)
    assert.throws(() => sessions.input(other.owner, id, 'test'), /not available/)
    assert.throws(() => sessions.close(other.owner, id), /not available/)
    first.emitter.emit('did-start-navigation', {}, 'http://localhost:5173/', false, true)
    assert.throws(() => sessions.replay(first.owner, id), /not available/)
    sessions.close(first.owner, id)
  } finally {
    sessions.closeAll()
  }
})

test(
  'agent terminal is scoped, survives reads and yields permanently to user input',
  { timeout: 20_000, skip: process.platform === 'win32' },
  async () => {
    const sessions = new LocalTerminalSessions()
    const { owner, emitter } = renderer()
    const scope = JSON.stringify(['team', 'conversation'])

    try {
      sessions.start(owner, 'agent-tab', 80, 24, undefined, scope)
      assert.throws(
        () => sessions.agentRequest('agent-tab', 'another-conversation', 'echo bad\r'),
        /another conversation/,
      )
      const ready = waitForOutput(emitter, 'AGENT_SHARED_OUTPUT')

      sessions.agentRequest('agent-tab', scope, "printf '%s%s\\n' AGENT_SHARED_ OUTPUT\r")
      await ready
      assert.match(sessions.agentRequest('agent-tab', scope).output, /AGENT_SHARED_OUTPUT/)
      sessions.input(owner, 'agent-tab', '', false)
      assert.equal(sessions.agentRequest('agent-tab', scope).userTookOver, false)
      sessions.input(owner, 'agent-tab', 'echo user')
      assert.equal(sessions.agentRequest('agent-tab', scope).userTookOver, true)
      assert.throws(() => sessions.agentRequest('agent-tab', scope, '\r'), /user took over/)
      const agentExited = new Promise<void>((resolve) => {
        emitter.on('terminal-event', (event: LocalTerminalEvent) => {
          if (event.id === 'agent-tab' && event.type === 'exit') resolve()
        })
      })

      sessions.input(owner, 'agent-tab', '\x15exit\r')
      await agentExited
      sessions.close(owner, 'agent-tab')
      assert.throws(() => sessions.agentRequest('agent-tab', scope), /no longer available/)
      sessions.start(owner, 'user-tab', 80, 24)
      const userReady = waitForOutput(emitter, 'USER_SHELL_READY')

      sessions.input(owner, 'user-tab', "printf '%s%s\\n' USER_SHELL_ READY\r")
      await userReady
      assert.throws(() => sessions.agentRequest('user-tab', scope), /another conversation/)
      const exited = new Promise<void>((resolve) => {
        emitter.on('terminal-event', (event: LocalTerminalEvent) => {
          if (event.id === 'user-tab' && event.type === 'exit') resolve()
        })
      })

      sessions.input(owner, 'user-tab', 'exit\r')
      await exited
    } finally {
      sessions.closeAll()
    }
  },
)
