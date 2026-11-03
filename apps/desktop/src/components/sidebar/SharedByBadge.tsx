import { t } from '../../i18n'
import { useAgentAppearance } from '../../lib/agentAppearance'
import { Avatar } from '../Avatar'
import { Tooltip } from '../ui/tooltip'

import { sharerName } from './shared-by'

import type { AgentConversationPerson } from '../../api'

/** The owner of an agent shared with the viewer, on the corner the runtime badge leaves free. */
export function SharedByBadge({ owner }: { owner: AgentConversationPerson }) {
  const { density } = useAgentAppearance()
  const name = sharerName(owner)
  const label = name ? t('Shared by {name}', { name }) : t('Shared by a teammate')
  const size = density === 'compact' ? 10 : 13

  return (
    <Tooltip content={label} triggerClassName="absolute -bottom-0.5 -left-0.5">
      <span
        role="img"
        aria-label={label}
        data-testid="chat-shared-by"
        className="flex rounded-full bg-main p-px"
      >
        <Avatar src={owner.avatarURL} name={name ?? '?'} size={size} className="rounded-full" />
      </span>
    </Tooltip>
  )
}
