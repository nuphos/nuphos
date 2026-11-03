import { SharedComputerLearnMore } from '../../components/SharedComputerLearnMore'
import { SHARED_COMPUTER_ACCESS } from '../../lib/sharedComputerDisclosure'

export function SharedComputerNotice() {
  return (
    <p className="text-[12px] leading-snug text-secondary">
      {SHARED_COMPUTER_ACCESS} <SharedComputerLearnMore />
    </p>
  )
}
