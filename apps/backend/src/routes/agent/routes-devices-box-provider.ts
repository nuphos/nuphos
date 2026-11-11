// The Box provider the device routes drive: instabox here, a stand-in in tests.

import {
  boxDesktopUrl,
  boxState,
  boxesAvailable,
  createBox,
  destroyBox,
  healBox,
  pauseBox,
  resumeBox,
} from '@/lib/agent/devices/box-instabox'
import { boxSizeView, resizeBox } from '@/lib/agent/devices/box-instabox-resize'

import type { BoxState } from '@/lib/agent/devices/box-instabox'
import type { AgentDevice } from '@/lib/agent/devices/store'

export type BoxProvider = {
  create: typeof createBox
  pause: (userId: string, deviceId: string) => Promise<AgentDevice>
  resume: (userId: string, deviceId: string) => Promise<AgentDevice>
  destroy: (userId: string, deviceId: string) => Promise<void>
  /** Its size and disk, and the sizes its account offers. */
  size: typeof boxSizeView
  /** Starts resizing it; a running one restarts. */
  resize: typeof resizeBox
  /** A link to the Box's desktop, to watch and take over what its agents do. */
  desktop: (userId: string, deviceId: string) => Promise<string>
  /** Starts the host again on a running machine whose host dropped; rate-limited. */
  heal: (userId: string, deviceId: string) => void
  /** Whether Boxes can be ordered here: a provider and a public URL for the machine to dial. */
  available: () => boolean
  state: (device: AgentDevice, online: boolean) => Promise<BoxState | 'gone'>
}

export const instaboxProvider: BoxProvider = {
  create: createBox,
  pause: pauseBox,
  resume: resumeBox,
  destroy: destroyBox,
  size: boxSizeView,
  resize: resizeBox,
  desktop: boxDesktopUrl,
  heal: healBox,
  available: boxesAvailable,
  state: boxState,
}
