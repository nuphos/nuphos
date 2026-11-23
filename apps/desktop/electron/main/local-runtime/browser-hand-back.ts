import { callJson, teamQuery } from '../../agent/http.ts'

/**
 * The person closed a tab's window the agent showed them: they hand the browser
 * back, and the conversation is woken to carry on, so they need not tell it they
 * are done. Best effort: a missed wake leaves it waiting for their next message.
 */
export function handBack(team: string, conversation: string, tab: number): void {
  callJson(
    'POST',
    `/agent/conversations/${encodeURIComponent(conversation)}/browser/hand-back${teamQuery(team)}`,
    { tab },
  ).catch(() => {})
}
