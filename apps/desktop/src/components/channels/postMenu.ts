import { Copy, CornerUpLeft, TextSelect } from 'lucide-react'

import { t } from '../../i18n'

import type { AgentMessageReply } from '../../api'
import type { ContextMenuItem } from '../ContextMenu'

const copy = (text: string) => void navigator.clipboard.writeText(text)

export type PostMenu = { selection: string; text: string; reply?: AgentMessageReply }

/** Copy what is selected, copy the whole post, then reply; each only where it applies. */
export function postMenuItems(
  menu: PostMenu,
  onReply?: (reply: AgentMessageReply) => void,
): ContextMenuItem[] {
  const copying: ContextMenuItem[] = [
    ...(menu.selection
      ? [
          {
            key: 'copy-selection',
            label: t('Copy selected text'),
            icon: TextSelect,
            onSelect: () => copy(menu.selection),
          },
        ]
      : []),
    ...(menu.text
      ? [
          {
            key: 'copy-message',
            label: t('Copy message'),
            icon: Copy,
            onSelect: () => copy(menu.text),
          },
        ]
      : []),
  ]
  const { reply } = menu
  const replying: ContextMenuItem[] =
    reply && onReply
      ? [{ key: 'reply', label: t('Reply'), icon: CornerUpLeft, onSelect: () => onReply(reply) }]
      : []

  return [
    ...copying,
    ...(copying.length > 0 && replying.length > 0
      ? [{ key: 'sep', separator: true as const }]
      : []),
    ...replying,
  ]
}
