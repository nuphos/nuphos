import type { Tab } from './model.ts'

export function startAutonomousTurn(tab: Tab, streamId: string, messageId: string): Tab {
  if (tab.streamId !== streamId) return tab
  // The same start event can replay after text or a transcript snapshot.
  // Identity comes from the event, not whether the last message is empty.
  if (tab.messages.some((message) => message.id === messageId)) return tab

  return {
    ...tab,
    connected: true,
    messages: [
      ...tab.messages,
      { id: messageId, role: 'assistant', parts: [], turnOrigin: 'autonomous' },
    ],
  }
}
