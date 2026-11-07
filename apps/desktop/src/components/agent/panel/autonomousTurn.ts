import type { Tab } from './model.ts'

export function startAutonomousTurn(tab: Tab, streamId: string, messageId: string): Tab {
  if (tab.streamId !== streamId) return tab
  // A replay from frame zero starts here and resends the whole run, so the
  // message it already built is emptied and rebuilt, not appended to.
  // Identity comes from the event, not whether the last message is empty.
  if (tab.messages.some((message) => message.id === messageId))
    return {
      ...tab,
      messages: tab.messages.map((message) =>
        message.id === messageId ? { ...message, parts: [] } : message,
      ),
    }

  return {
    ...tab,
    connected: true,
    messages: [
      ...tab.messages,
      { id: messageId, role: 'assistant', parts: [], turnOrigin: 'autonomous' },
    ],
  }
}
