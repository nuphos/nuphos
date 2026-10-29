import type { AgentDevice } from '../../api/device-types'

export type DeskModel = {
  /** A laptop opens its lid; a box (a Mac mini, a Box) turns to show its front, its readings card
   * over its side. */
  form: 'laptop' | 'box'
  /** The finish it is drawn in. `other` is the plain laptop for a machine whose maker Nuphos cannot
   * tell; `nuphos` is a Box, black with Nuphos's mark. */
  brand: 'apple' | 'windows' | 'other' | 'nuphos'
}

// Desktop Apple apps report the "Model Name" from system_profiler: "MacBook Pro", "Mac mini"…
const DESKTOP_MAC = /Mac ?mini|Mac Studio|Mac Pro|iMac/iu

/** How the Computers desk draws a machine. */
export function deskModel(device: AgentDevice): DeskModel {
  if (device.box) return { form: 'box', brand: 'nuphos' }
  // A Mac that does not name its model is most likely a MacBook.
  if (device.platform === 'darwin')
    return { form: DESKTOP_MAC.test(device.model ?? '') ? 'box' : 'laptop', brand: 'apple' }
  // Windows and Linux hosts report no model, so neither can be told from a desktop yet.
  if (device.platform === 'win32') return { form: 'laptop', brand: 'windows' }

  return { form: 'laptop', brand: 'other' }
}

/** The closed view holds this long, then every machine turns at once. */
export const DESK_OPEN_AFTER_MS = 250

/** One opening, from its start to the last frame (the dock settling); see BoxDesk.css. */
export const DESK_OPENING_MS = 1250

/**
 * Milliseconds until a machine shown at `now` opens. Machines shown while an opening is
 * still under way join it, so ten computers open together however their rows arrive; one
 * shown after it has finished starts a new opening. `wave.at` is the shared start time.
 */
export function deskOpenDelay(now: number, wave: { at: number }): number {
  if (now > wave.at + DESK_OPENING_MS) wave.at = now + DESK_OPEN_AFTER_MS

  return Math.max(0, wave.at - now)
}
