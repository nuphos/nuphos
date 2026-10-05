import type { TeamMember } from '../../../types'

/** The `@query` being typed right before the caret, or null when there is none.
 *  An `@` only starts a mention at the start of a line or after whitespace, so
 *  an email address being typed never opens the picker. */
export function mentionQuery(textBeforeCaret: string): string | null {
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(textBeforeCaret)

  return match ? match[1] : null
}

/** Current members whose name, username or email contains the query. */
export function matchMembers(
  members: readonly TeamMember[],
  query: string,
  limit = 6,
): TeamMember[] {
  const needle = query.toLowerCase()

  return members
    .filter(
      (member) =>
        !member.removedAt &&
        [member.name, member.username, member.email].some((value) =>
          value?.toLowerCase().includes(needle),
        ),
    )
    .slice(0, limit)
}
