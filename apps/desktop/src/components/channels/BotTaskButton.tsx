import { t } from '../../i18n'
import { AgentProviderIcon } from '../agent/panel/icons'
import { Button } from '../ui/button'

import type { AgentProvider } from '../../types/runtime'

export function BotTaskButton({
  onClick,
  provider,
}: {
  onClick: () => void
  provider?: AgentProvider
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="titlebar-no-drag"
      title={t('Open session')}
      onClick={onClick}
    >
      <AgentProviderIcon provider={provider} className="size-4" />
      {t('Task')}
    </Button>
  )
}
