import { Smartphone } from 'lucide-react'

import { api } from '../../api'
import { useWatchedTabsOfSession } from '../../app/workspace/watchedDockTabs'
import { t } from '../../i18n'
import { Tooltip } from '../ui/tooltip'

import type { SyntheticEvent } from 'react'

const stop = (event: SyntheticEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * A phone is viewing one of this conversation's dock tabs. The tab shows it too,
 * but only while that dock is open; the row shows it whatever is on screen.
 * One click stops every tab the phone views here.
 */
export function PhoneViewingBadge({ sessionId }: { sessionId: string }) {
  const tabs = useWatchedTabsOfSession(sessionId)

  if (tabs.length === 0) return null

  return (
    <Tooltip content={t('Viewing from iPhone. Click to stop.')}>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          stop(event)
          for (const tab of tabs) api.stopDockTabWatch(tab)
        }}
        className="titlebar-no-drag flex-shrink-0 w-[18px] h-[18px] rounded flex items-center justify-center text-zViolet-400 hover:bg-zGray-800/70 hover:text-zViolet-300 outline-none focus-visible:outline-none"
        aria-label={t('Stop viewing from iPhone')}
        data-testid="chat-viewed-from-phone"
      >
        <Smartphone className="w-3.5 h-3.5" strokeWidth={1.8} />
      </button>
    </Tooltip>
  )
}
