import { BrowserWindow } from 'electron'

import { localTerminals } from '../local-terminal'
import { runtimeTerminals } from '../runtime-terminal'

import type { TerminalTarget } from '../../src/api/local-terminal-types'
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
    throw new Error('Local terminals are only available to the desktop app.')
  }

  return contents
}

const terminals = (event: IpcMainInvokeEvent, id: string) =>
  runtimeTerminals.describe(owner(event), id) ? runtimeTerminals : localTerminals

export const localTerminalChannels = {
  'local-terminal:start': (
    event: IpcMainInvokeEvent,
    id: string,
    cols: number,
    rows: number,
    target?: TerminalTarget,
  ) =>
    target
      ? runtimeTerminals.start(owner(event), id, target, cols, rows)
      : localTerminals.start(owner(event), id, cols, rows),
  'local-terminal:replay': (event: IpcMainInvokeEvent, id: string) =>
    terminals(event, id).replay(owner(event), id),
  'local-terminal:input': (event: IpcMainInvokeEvent, id: string, data: string) =>
    terminals(event, id).input(owner(event), id, data),
  'local-terminal:resize': (event: IpcMainInvokeEvent, id: string, cols: number, rows: number) =>
    terminals(event, id).resize(owner(event), id, cols, rows),
  'local-terminal:close': (event: IpcMainInvokeEvent, id: string) =>
    terminals(event, id).close(owner(event), id),
}
