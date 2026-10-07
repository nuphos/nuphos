import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { EMPTY_HOME_LAYOUT } from './homeWidgetSettings'

import type { HomeLayout, HomeLayouts } from '../../../types/team.ts'

/**
 * The home page layout, stored on the server so it follows the user across
 * machines. A member sees their own layout once they change anything, and the
 * team default until then. Writes apply locally first; a failed save reloads
 * what the server has.
 */
export function useHomeLayout(teamId: string) {
  const [saved, setSaved] = useState<HomeLayouts | null>(null)

  const reload = useCallback(() => {
    api
      .atlasGetHomeLayout(teamId)
      .then(setSaved, () => setSaved((prev) => prev ?? { personal: null, team: null }))
  }, [teamId])

  useEffect(reload, [reload])

  const save = (scope: 'personal' | 'team', layout: HomeLayout | null, next: HomeLayouts) => {
    setSaved(next)
    api.atlasPutHomeLayout(teamId, scope, layout).catch((err: unknown) => {
      toast.apiError('Could not save the home layout', err)
      reload()
    })
  }

  const layout = saved ? (saved.personal ?? saved.team ?? EMPTY_HOME_LAYOUT) : null

  return {
    /** Null while the first read is in flight. */
    layout,
    customized: Boolean(saved?.personal),
    update: (next: HomeLayout) => saved && save('personal', next, { ...saved, personal: next }),
    resetToTeamDefault: () => saved && save('personal', null, { ...saved, personal: null }),
    setAsTeamDefault: () => saved && layout && save('team', layout, { ...saved, team: layout }),
  }
}
