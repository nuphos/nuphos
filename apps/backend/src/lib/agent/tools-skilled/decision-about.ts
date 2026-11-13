import { z } from 'zod'

/** What a request_user_decision question is about: its changes remind the agent of it, and the conversations it names are told the answer. */
export const aboutField = z
  .array(z.string().trim().min(1).max(300))
  .min(1)
  .max(5)
  .describe(
    'What the question is about: the `id` of a resource linked to this conversation (bind_session_resource / list_session_resources) or the threadId of another conversation you own in this team (e.g. a sub-agent thread, or the session that will act on the answer): that conversation is told the answer too.',
  )
