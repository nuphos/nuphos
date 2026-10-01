// A plan approved in the Nuphos app still has to execute where it lives.
//
// When the plan's conversation is a Slack thread, the execution turn runs in
// that thread's pipeline so the thread that asked for the approval sees the
// work happen. (Slack-bound conversations are owner-writable in the app these
// days — routes/agent/chat-slack-bound.ts mirrors typed turns into the thread
// — but plan approval is a button press, not a typed turn, so it resumes
// through the Slack pipeline directly.) Without this the plan sat at
// `approved` forever and the thread was never told — the Slack Approve button
// was the only path that worked.
//
// The thread lookup lives here so the common case (a plan with no Slack thread)
// never loads the Slack route module at all. That module imports routes/agent.ts,
// which is what makes the import below lazy rather than static.
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'

type ResumeThreadTurn = (typeof import('@/routes/slack'))['resumeApprovedPlanTurnFromNuphos']

export async function resumeSlackThreadForApprovedPlan(
  args: {
    sessionId: string
    /** The plan number (#N) — the public id the Slack resume renders and logs. */
    planId: string
    planTitle: string
    approverNuphosUserId: string
  },
  // Injected by tests. Mocking '@/routes/slack' instead would replace it for
  // every suite in the process, and the Slack route's own tests import the real
  // export.
  resume?: ResumeThreadTurn,
): Promise<void> {
  const thread = await getSlackAgentThreadBySessionId(args.sessionId)

  if (!thread) return
  const resumeApprovedPlanTurnFromNuphos =
    resume ?? (await import('@/routes/slack')).resumeApprovedPlanTurnFromNuphos

  await resumeApprovedPlanTurnFromNuphos({
    thread,
    planId: args.planId,
    planTitle: args.planTitle,
    approverNuphosUserId: args.approverNuphosUserId,
  })
}
