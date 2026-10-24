import { ipcRenderer } from 'electron'

import type { BadgeStat, ProfileCharacter } from '../../src/types/team'

export const profileApi = {
  authSetCharacter: (character: ProfileCharacter | null) =>
    ipcRenderer.invoke('auth:setCharacter', character),
  authSetBadgeStat: (badgeStat: BadgeStat) => ipcRenderer.invoke('auth:setBadgeStat', badgeStat),
  authReadMergedPrs: (teamId: string, timeZone: string) =>
    ipcRenderer.invoke('auth:readMergedPrs', teamId, timeZone),
}
