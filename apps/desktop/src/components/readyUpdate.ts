import { updateProgress } from '../views/settings/updateProgress.ts'

import type { UpdaterState } from '../types/team.ts'

export type ReadyUpdate = {
  version: string
  /** Set while a newer release downloads to replace the update that was on offer. */
  percent: number | null
  /** The installer download, when the last restart came back without this version. */
  installerUrl: string | null
}

/** The update the sidebar offers. A newer release that comes out while one is on offer
 * downloads in its place; the offer stays, with the percent, until that one is ready. */
export function readyUpdate(state: UpdaterState, offered: boolean): ReadyUpdate | null {
  if (state.kind === 'ready') {
    return { version: state.version, percent: null, installerUrl: state.installerUrl }
  }
  if (state.kind === 'downloading' && offered) {
    return {
      version: state.version,
      percent: updateProgress(state)?.percent ?? 0,
      installerUrl: null,
    }
  }

  return null
}
