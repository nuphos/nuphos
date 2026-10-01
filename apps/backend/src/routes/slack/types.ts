export type SlackEventEnvelope = {
  type?: string
  challenge?: string
  team_id?: string
  event_id?: string
  event_time?: number
  event?: SlackMessageEvent
}

// Present on assistant_thread_started / assistant_thread_context_changed:
// which assistant thread the event is about, and what the user was viewing in
// Slack at the time (the assistant panel opens in a split view next to it).
export type SlackAssistantThreadInfo = {
  user_id?: string
  channel_id?: string
  thread_ts?: string
  context?: { channel_id?: string; team_id?: string; enterprise_id?: string }
}

export type SlackMessageEvent = {
  type?: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  // Author of the thread root, present on threaded replies. Tells us whether a
  // reply in an unbound thread is aimed at something the bot itself posted.
  parent_user_id?: string
  channel?: string
  // 'im' for a direct message in the app's Chat/History tabs (assistant_view);
  // routed to the assistant DM agent instead of the channel-thread handler.
  channel_type?: string
  event_ts?: string
  subtype?: string
  bot_id?: string
  // Per-turn token Slack attaches to message.*/app_mention payloads. Required
  // to call assistant.search.context with a bot token (the slack_search tool);
  // plumbed through to createSlackReplyToolContext.
  action_token?: string
  assistant_thread?: SlackAssistantThreadInfo
  // Present on app_home_opened: which App Home tab was opened ('home',
  // 'messages', …). Only 'home' has a view to publish.
  tab?: string
  // Attachments. Slack delivers a message carrying files with
  // subtype 'file_share', which is why the subtype filters allow that one
  // through — dropping it silenced the message text as well as the file.
  files?: SlackFileRef[]
}

export type SlackFileRef = {
  id?: string
  name?: string
  title?: string
  mimetype?: string
  filetype?: string
  size?: number
  // Authenticated download URL; needs the bot token as a bearer credential.
  url_private?: string
}

export type SlackRuntime = {
  botToken: string
  botUserId: string
}

export type SlackAppMentionEvent = SlackMessageEvent & {
  type: 'app_mention'
}

// Identifies a thread's rolling transcript (slack_agent_threads).
export type SlackThreadKey = {
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
}

export type SlackInteractionPayload = {
  type?: string
  user?: { id?: string }
  team?: { id?: string }
  channel?: { id?: string }
  message?: { ts?: string; thread_ts?: string }
  // Signed, short-lived callback (valid ~30 min, up to 5 posts) for updating or
  // replacing the message the interaction came from. Present for message-based
  // block_actions; absent for view (Home tab) actions, where Slack ignores the
  // interaction response body and updates must go through views.publish / a DM.
  response_url?: string
  // Present when the action originated from a published view (Home tab). Such
  // actions carry no response_url — Slack ignores the interaction response
  // body, so feedback must go through views.publish (or a DM) instead.
  view?: { type?: string }
  actions?: { action_id?: string; selected_conversation?: string; value?: string }[]
}
