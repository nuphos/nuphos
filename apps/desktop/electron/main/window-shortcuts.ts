import { computersShortcut } from '../../src/lib/computersShortcut'
import { regionShortcut } from '../../src/lib/regionShortcut'

import { liveSessionShortcut } from './session-shortcuts'

import type { Input, WebContents } from 'electron'

/** Session commands stay scoped to a chat; navigation commands work throughout the window. */
export function windowShortcut(contents: WebContents, input: Input) {
  return (
    liveSessionShortcut(contents, input) ??
    regionShortcut(input) ??
    computersShortcut(input, process.platform === 'darwin')
  )
}
