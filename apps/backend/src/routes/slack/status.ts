import { logEvent } from '@/lib/observability'
import { setSlackAssistantStatus, setSlackAssistantTitle } from '@/lib/slack/api'

import type { SlackSuggestedPrompt } from '@/lib/slack/api'
import type { SlackRuntime } from '@/routes/slack/types'

// Suggested prompt chips offered when a user opens a new Chat-tab thread (max 4).
const ASSISTANT_SUGGESTED_PROMPTS: SlackSuggestedPrompt[] = [
  { title: 'Review a PR', message: 'Review the latest open pull request and summarize the risks' },
  { title: 'Recent alerts', message: 'Which recent alerts need attention?' },
  { title: 'Debug service', message: 'Help me figure out why a service is not working' },
  { title: 'Triage issues', message: 'Which open issues need attention first?' },
]

export const ASSISTANT_PROMPTS_TITLE = 'Try these:'
export const ASSISTANT_THINKING_STATUS = 'is thinking…'
// Rotating flavor lines Slack cycles under the thinking indicator while the
// turn runs (assistant.threads.setStatus loading_messages, API cap: 10).
// Ordered roughly like a real turn so the rotation reads as progress.
export const ASSISTANT_LOADING_MESSAGES = [
  'Reading the conversation…',
  'Recalling context…',
  'Searching the knowledge base…',
  'Running tools…',
  'Checking the results…',
  'Writing a reply…',
]

// Posted once per new Chat-tab thread (assistant_thread_started fires when the
// user starts a fresh conversation, not on every tab visit, so this can greet
// without spamming).
export const ASSISTANT_GREETING =
  "👋 I'm Nuphos, your team's agent. Ask me to review code, triage issues, debug a service, or dig into an alert — or pick a prompt below."

// When we know which channel the user is looking at, lead with a prompt about
// it (backed by the slack_search tool); otherwise show the static set.
export function buildSuggestedPrompts(contextChannelId?: string): SlackSuggestedPrompt[] {
  if (!contextChannelId) return ASSISTANT_SUGGESTED_PROMPTS

  return [
    {
      title: 'Summarize this channel',
      message: `Summarize recent discussion highlights in <#${contextChannelId}> — anything I should look at?`,
    },
    ...ASSISTANT_SUGGESTED_PROMPTS.slice(0, 3),
  ]
}

// The "I heard you" signal for a channel thread. Fired after the event owns the
// per-session run claim: a concurrent teammate's message must not replace the
// active actor's tool/status line while it is being rejected or queued.
//
// Detached on purpose: this is cosmetic, and awaiting a Slack round-trip here
// would add the very latency it exists to hide.
export function beginThreadStatus(
  runtime: SlackRuntime,
  channelId: string,
  threadTs: string,
): void {
  void setAssistantStatusSafe(
    runtime.botToken,
    channelId,
    threadTs,
    ASSISTANT_THINKING_STATUS,
    ASSISTANT_LOADING_MESSAGES,
  )
}

export async function setAssistantStatusSafe(
  token: string,
  channelId: string,
  threadTs: string,
  status: string,
  loadingMessages?: string[],
): Promise<void> {
  try {
    await setSlackAssistantStatus({ token, channelId, threadTs, status, loadingMessages })
  } catch (err) {
    logEvent('warn', 'slack.assistant.set_status_failed', {
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Names the thread in the History tab so past conversations are identifiable.
// Best-effort: a failed title must never fail the turn.
export async function setAssistantTitleSafe(
  token: string,
  channelId: string,
  threadTs: string,
  title: string,
): Promise<void> {
  try {
    await setSlackAssistantTitle({ token, channelId, threadTs, title })
  } catch (err) {
    logEvent('warn', 'slack.assistant.set_title_failed', {
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function deriveThreadTitle(text: string): string {
  const firstLine = (text.split('\n').find((line) => line.trim()) ?? text).trim()

  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine
}
