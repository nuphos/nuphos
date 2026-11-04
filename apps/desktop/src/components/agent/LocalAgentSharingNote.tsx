import { Info } from 'lucide-react'

import { LOCAL_AGENT_SHARING_NOTE } from '../../lib/localAgentSharing'
import { SharedComputerLearnMore } from '../SharedComputerLearnMore'

/** In the Share card of the owner's session on their own computer: who may send there. */
export function LocalAgentSharingNote() {
  return (
    <div className="flex gap-2 px-1 text-[12px] leading-snug text-tertiary">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span>
        {LOCAL_AGENT_SHARING_NOTE} <SharedComputerLearnMore />
      </span>
    </div>
  )
}
