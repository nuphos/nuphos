import { useState } from 'react'

import { EditableConversationTitle } from '../agent/panel/ConversationTitleEditor'

/**
 * A chat's name in its header. A Bot's chat is called by the Bot's name, so
 * its owner renames the Bot here, as on its Task; the chat reloads after.
 */
export function ChannelTitle({
  bot,
  title,
  teamId,
  canRename,
  onRenamed,
}: {
  bot: string | undefined
  title: string
  teamId: string
  canRename: boolean
  onRenamed: () => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <span className="min-w-0 truncate text-main">
      <EditableConversationTitle
        sessionId={bot ?? null}
        teamId={teamId}
        title={title}
        canRename={Boolean(bot) && canRename}
        editing={renaming}
        onEditingChange={(editing) => {
          setRenaming(editing)
          if (!editing) onRenamed()
        }}
      />
    </span>
  )
}
