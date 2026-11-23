import { z } from 'zod'

const issuePayload = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive() }),
  action: z.string().max(100).optional(),
  issue: z.object({ number: z.number().int().positive(), state: z.string() }),
})

/**
 * The state a linked issue's tag should show after it closes or reopens. Like a
 * PR's, this includes our own events; only the wakeup skips them.
 */
export function githubIssueState(event: string, payload: unknown) {
  const parsed = issuePayload.safeParse(payload)

  if (event !== 'issues' || !parsed.success) return null
  const { action, installation, repository, issue } = parsed.data

  if (!['closed', 'reopened'].includes(action ?? '')) return null

  return {
    key: `github/${String(installation.id)}/${String(repository.id)}/${String(issue.number)}`,
    state: issue.state,
    draft: false,
  }
}
