import { slackApiGet } from '@/lib/slack/api/client'

import type { SlackApiResponse } from '@/lib/slack/api/client'

export type SlackMember = {
  id: string
  name: string
  displayName: string
  realName: string
  isBot: boolean
}

type SlackUser = {
  id: string
  name?: string
  deleted?: boolean
  is_bot?: boolean
  real_name?: string
  profile?: { display_name?: string; real_name?: string }
}

const PAGE = 200
const MAX_PAGES = 10

// Walks a cursor-paged Slack list while `take` asks for more; true if pages were left.
async function walk(
  token: string,
  method: string,
  params: Record<string, string>,
  take: (json: SlackApiResponse) => boolean,
): Promise<boolean> {
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await slackApiGet(token, method, { ...params, limit: PAGE, cursor })

    cursor = json.response_metadata?.next_cursor?.trim()
    if (!take(json) || !cursor) return false
  }

  return true
}

function toMember(user: SlackUser): SlackMember {
  return {
    id: user.id,
    name: user.name ?? '',
    displayName: user.profile?.display_name ?? '',
    realName: user.profile?.real_name ?? user.real_name ?? '',
    isBot: user.is_bot === true,
  }
}

// The people in a channel, with the names a mention needs: conversations.members
// says who is there, users.list names them. Two paged calls rather than a users.info
// per member, and only the users:read scope every install already has. A member
// users.list does not name within MAX_PAGES (a big workspace, a Slack Connect guest)
// is left out and reported through `truncated`.
export async function fetchSlackChannelMembers(args: {
  token: string
  channel: string
}): Promise<{ members: SlackMember[]; truncated: boolean }> {
  const ids = new Set<string>()
  const found = new Set<string>()
  const members: SlackMember[] = []
  const moreMembers = await walk(
    args.token,
    'conversations.members',
    { channel: args.channel },
    (json) => {
      for (const id of json.members ?? []) ids.add(id)

      return true
    },
  )

  await walk(args.token, 'users.list', {}, (json) => {
    for (const user of (json.members ?? []) as unknown as SlackUser[]) {
      if (!ids.has(user.id)) continue
      found.add(user.id)
      if (!user.deleted) members.push(toMember(user))
    }

    return found.size < ids.size
  })

  return { members, truncated: moreMembers || found.size < ids.size }
}
