import { TriangleAlert } from 'lucide-react'

import {
  SHARED_COMPUTER_ACCESS,
  SHARED_COMPUTER_AUDIT,
  SHARED_COMPUTER_PRIVACY,
} from '../../lib/sharedComputerDisclosure'

export function SharedComputerNotice() {
  return (
    <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-secondary">
      <p className="flex gap-2 text-warning">
        <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {SHARED_COMPUTER_ACCESS}
      </p>
      <p>{SHARED_COMPUTER_PRIVACY}</p>
      <p>{SHARED_COMPUTER_AUDIT}</p>
    </div>
  )
}
