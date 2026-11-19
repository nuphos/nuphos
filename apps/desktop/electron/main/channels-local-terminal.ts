import { BrowserWindow } from 'electron'

import { acceptDockTerminal } from '../agent/dock-terminal'
import { localTerminals } from '../local-terminal'
import { runtimeDesktops } from '../runtime-desktop'
import { runtimeTerminals } from '../runtime-terminal'

import { sshHosts, sshJoin, sshJoinCancel } from './ssh-join'

import type { DesktopTarget, TerminalTarget } from '../../src/api/local-terminal-types'
import type { IpcMainInvokeEvent } from 'electron'

function owner(event: IpcMainInvokeEvent) {
  const contents = event.sender
  const expected = process.env.VITE_DEV_SERVER_URL || 'app://./index.html'
  const expectedUrl = new URL(expected)
  const frame = event.senderFrame
  const actual = frame ? new URL(frame.url) : null

  if (
    contents.getType() !== 'window' ||
    !BrowserWindow.fromWebContents(contents) ||
    frame !== contents.mainFrame ||
    actual?.protocol !== expectedUrl.protocol ||
    actual.host !== expectedUrl.host ||
    (actual.protocol === 'app:' && actual.pathname !== expectedUrl.pathname)
  ) {
    throw new Error('Only the desktop app can run local processes.')
  }

  return contents
}

const terminals = (event: IpcMainInvokeEvent, id: string) =>
  runtimeTerminals.describe(owner(event), id) ? runtimeTerminals : localTerminals

const string = (value: unknown) => {
  if (typeof value !== 'string') throw new TypeError('Expected a string')

  return value
}

export const localTerminalChannels = {
  // Connecting your own computer over SSH runs the local ssh, so it is guarded like a terminal.
  'ssh:hosts': (event: IpcMainInvokeEvent) => {
    owner(event)

    return sshHosts()
  },
  'ssh:join': (event: IpcMainInvokeEvent, id: unknown, target: unknown) =>
    sshJoin(owner(event), string(id), string(target)),
  'ssh:cancel': (event: IpcMainInvokeEvent, id: unknown) => {
    owner(event)
    sshJoinCancel(string(id))
  },
  'local-terminal:accept-dock': (event: IpcMainInvokeEvent, id: string) =>
    acceptDockTerminal(owner(event), id),
  'local-terminal:processes': (event: IpcMainInvokeEvent) => localTerminals.processes(owner(event)),
  'local-terminal:start': (
    event: IpcMainInvokeEvent,
    id: string,
    cols: number,
    rows: number,
    target?: TerminalTarget,
    conversationId?: string,
  ) =>
    target
      ? runtimeTerminals.start(owner(event), id, target, cols, rows)
      : localTerminals.start(owner(event), id, cols, rows, undefined, conversationId),
  'local-terminal:replay': (event: IpcMainInvokeEvent, id: string) =>
    terminals(event, id).replay(owner(event), id),
  'local-terminal:input': (event: IpcMainInvokeEvent, id: string, data: string) =>
    runtimeTerminals.describe(owner(event), id)
      ? runtimeTerminals.input(owner(event), id, data)
      : localTerminals.input(owner(event), id, data),
  'local-terminal:resize': (event: IpcMainInvokeEvent, id: string, cols: number, rows: number) =>
    terminals(event, id).resize(owner(event), id, cols, rows),
  'local-terminal:close': (event: IpcMainInvokeEvent, id: string) =>
    terminals(event, id).close(owner(event), id),
  'runtime-desktop:start': (event: IpcMainInvokeEvent, id: string, target: DesktopTarget) =>
    runtimeDesktops.start(owner(event), id, target),
  'runtime-desktop:input': (event: IpcMainInvokeEvent, id: string, data: string) =>
    runtimeDesktops.input(owner(event), id, data),
  'runtime-desktop:close': (event: IpcMainInvokeEvent, id: string) =>
    runtimeDesktops.close(owner(event), id),
}
