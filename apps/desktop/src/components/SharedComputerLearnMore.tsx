import { api } from '../api'
import { t } from '../i18n'
import { SHARED_COMPUTER_DOCS_URL } from '../lib/sharedComputerDisclosure'

export function SharedComputerLearnMore() {
  return (
    <button
      type="button"
      className="text-secondary underline underline-offset-2 hover:text-main"
      onClick={() => void api.appOpenExternal(SHARED_COMPUTER_DOCS_URL)}
    >
      {t('Learn more')}
    </button>
  )
}
