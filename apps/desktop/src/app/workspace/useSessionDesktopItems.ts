import { Monitor } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { canOpenSessionDesktop, subscribeSessionDesktops } from '../../lib/sessionDesktops'

import { openSessionDesktop } from './openSessionDesktop'

import type { Item } from '../../components/sidebar/types'

/** "Desktop" in the dock's New Tab: the conversation's own desktop, where its Box runs a pool. */
export function useSessionDesktopItems(teamId: string, sessionId?: string | null): Item[] {
  const canOpen = useSyncExternalStore(subscribeSessionDesktops, () =>
    canOpenSessionDesktop(sessionId),
  )

  if (!sessionId || !canOpen) return []

  return [
    {
      key: 'team.desktop.session',
      label: 'Desktop',
      icon: Monitor,
      enabled: true,
      onActivate: () => {
        openSessionDesktop(teamId, sessionId, api.openSessionDesktop).catch((error: unknown) => {
          toast.apiError('Could not open the desktop', error)
        })
      },
    },
  ]
}
