import { Popover } from '@base-ui/react/popover'
import { Info } from 'lucide-react'

import { t } from '../../i18n'
import { LOCAL_AGENT_SHARING_NOTE, openAgentMenu } from '../../lib/localAgentSharing'

/** In the Share card of the owner's session on their own computer: teammates
 *  can read it but not send, so offer the move that lets them join. */
export function LocalAgentSharingNote({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex gap-2 px-1 text-[12px] leading-snug text-tertiary">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {LOCAL_AGENT_SHARING_NOTE}
        {/* The composer's agent picker does the move, with its own confirmations. */}
        <Popover.Close
          className="rounded text-zViolet-400 hover:text-zViolet-300 hover:underline"
          onClick={() => openAgentMenu(sessionId)}
        >
          {t('Move to a team runtime')}
        </Popover.Close>
      </div>
    </div>
  )
}
