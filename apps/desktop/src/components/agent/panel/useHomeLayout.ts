import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { editableLayout } from './homeWidgetSettings'

import type { HomeLayout, HomeLayouts } from '../../../types/team.ts'

const RETRY_MS = 30_000

/**
 * The home page layout, stored on the server so it follows the user across
 * machines. A member sees their own layout once they change anything, and the
 * team default until then. Writes apply locally first; a failed save reloads
 * what the server has.
 */
export function useHomeLayout(teamId: string) {
  const [saved, setSaved] = useState<HomeLayouts | null>(null)

  const reload = useCallback(() => {
    // A failed read leaves `saved` as it was; see editableLayout.
    api.atlasGetHomeLayout(teamId).then(setSaved, () => {})
  }, [teamId])

  useEffect(reload, [reload])

  // Until the first read succeeds, keep trying in the background.
  useEffect(() => {
    if (saved) return
    const timer = setInterval(reload, RETRY_MS)

    return () => clearInterval(timer)
  }, [saved, reload])

  const save = (scope: 'personal' | 'team', layout: HomeLayout | null, next: HomeLayouts) => {
    setSaved(next)
    api.atlasPutHomeLayout(teamId, scope, layout).catch((err: unknown) => {
      toast.apiError('Could not save the home layout', err)
      reload()
    })
  }

  const layout = editableLayout(saved)

  return {
    /** Null until a read succeeds; nothing is shown or editable before then. */
    layout,
    customized: Boolean(saved?.personal),
    update: (next: HomeLayout) => saved && save('personal', next, { ...saved, personal: next }),
    resetToTeamDefault: () => saved && save('personal', null, { ...saved, personal: null }),
    setAsTeamDefault: () => saved && layout && save('team', layout, { ...saved, team: layout }),
  }
}
