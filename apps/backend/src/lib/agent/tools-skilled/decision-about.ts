import { z } from 'zod'

/** What a request_user_decision question is about: its changes remind the agent of it. */
export const aboutField = z
  .array(z.string().trim().min(1).max(300))
  .min(1)
  .max(5)
  .describe(
    'What the question is about: the `id` of a resource linked to this conversation (bind_session_resource / list_session_resources) or the threadId of your own sub-agent thread.',
  )
