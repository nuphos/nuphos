import { selectInboxQuestion } from '../../views/inbox/inboxSelection.ts'

/**
 * Brings an open question to the viewer: its card in this chat, the oldest
 * first, marked for a moment; where the chat draws none, the Inbox opens on it.
 */
export function showBotQuestion(
  chat: HTMLElement | null,
  teamId: string,
  id: string,
  openLink?: (href: string) => boolean,
) {
  const card = chat?.querySelector('[data-open-question]')

  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 450, iterations: 2 })

    return
  }
  selectInboxQuestion(teamId, { id, index: 0 })
  openLink?.(`/teams/${teamId}/inbox`)
}
