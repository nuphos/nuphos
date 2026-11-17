import { z } from 'zod'

import { config } from '@/config'
import { composioAuthConfigId, composioRequest } from '@/lib/composio'
import { AppError } from '@/lib/errors'

const VERSION = '20261104_00'

const id = z.string().regex(/^[a-f0-9]{24}$/iu)
const memberId = z.union([z.literal('me'), id])
const date = z.string().datetime({ offset: true })
const position = z.union([z.enum(['top', 'bottom']), z.number().finite().nonnegative()])
const name = z.string().trim().min(1).max(1024)
const description = z.string().max(16384)
const text = z.string().min(1).max(16384)
const csv = (allowed: readonly string[]) =>
  z
    .string()
    .max(200)
    .refine((value) => value.split(',').every((field) => allowed.includes(field)))
const boardFields = csv([
  'id',
  'name',
  'desc',
  'closed',
  'url',
  'shortUrl',
  'idOrganization',
]).default('id,name,url,closed')
const listFields = csv(['id', 'name', 'closed', 'idBoard', 'pos']).default(
  'id,name,closed,idBoard,pos',
)
const cardFields = csv([
  'id',
  'name',
  'desc',
  'closed',
  'idBoard',
  'idList',
  'url',
  'shortUrl',
  'due',
  'pos',
  'dateLastActivity',
]).default('id,name,desc,closed,idBoard,idList,url,due')
const page = {
  fields: cardFields,
  limit: z.number().int().min(1).max(100).default(100),
  before: z.union([id, date]).optional(),
}
const cardChanges = {
  name: name.optional(),
  desc: description.optional(),
  closed: z.boolean().optional(),
  due: date.optional(),
  pos: position.optional(),
}

const TOOL_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  TRELLO_GET_MEMBERS_BY_ID_MEMBER: z
    .object({
      idMember: memberId,
      fields: csv(['id', 'username', 'fullName', 'url']).default('id,username'),
    })
    .strict(),
  TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER: z
    .object({
      idMember: memberId,
      fields: boardFields,
      filter: z.enum(['all', 'open', 'closed', 'starred']).default('open'),
    })
    .strict(),
  TRELLO_GET_BOARDS_BY_ID_BOARD: z.object({ idBoard: id, fields: boardFields }).strict(),
  TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD: z
    .object({
      idBoard: id,
      fields: listFields,
      filter: z.enum(['all', 'open', 'closed']).default('open'),
    })
    .strict(),
  TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD: z.object({ idBoard: id, ...page }).strict(),
  TRELLO_GET_LISTS_CARDS_BY_ID_LIST: z.object({ idList: id, ...page }).strict(),
  TRELLO_GET_CARDS_BY_ID_CARD: z.object({ idCard: id, fields: cardFields }).strict(),
  TRELLO_ADD_LISTS: z.object({ name, idBoard: id, pos: position.optional() }).strict(),
  TRELLO_UPDATE_LISTS_BY_ID_LIST: z
    .object({
      idList: id,
      name: name.optional(),
      closed: z.boolean().optional(),
      pos: position.optional(),
    })
    .strict(),
  TRELLO_ADD_CARDS: z
    .object({
      name,
      idList: id,
      desc: description.optional(),
      due: date.optional(),
      pos: position.optional(),
    })
    .strict(),
  TRELLO_UPDATE_CARDS_BY_ID_CARD: z.object({ idCard: id, ...cardChanges }).strict(),
  TRELLO_UPDATE_CARDS_ID_LIST_BY_ID_CARD: z.object({ idCard: id, value: id }).strict(),
  TRELLO_ADD_CARDS_ACTIONS_COMMENTS_BY_ID_CARD: z.object({ idCard: id, text }).strict(),
}

export const TRELLO_TOOLS = new Set(Object.keys(TOOL_SCHEMAS))

export function trelloToolArguments(tool: string, args: Record<string, unknown>) {
  const parsed = TOOL_SCHEMAS[tool]?.safeParse(args)

  if (!parsed?.success)
    throw new AppError(400, 'trello_arguments_not_allowed', 'Unsupported Trello tool arguments')

  // Every input of the pinned Composio Trello tools is a string; numbers and booleans fail there.
  return Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, String(value)]))
}

function trelloAuthConfig(): Promise<string> {
  if (!config.byos.composio.apiKey) {
    throw new AppError(
      503,
      'trello_not_configured',
      'Trello connection is not configured on this server',
    )
  }

  return composioAuthConfigId('trello')
}

export async function trelloConnectLink(userId: string, callbackUrl: string) {
  const link = await composioRequest<{ redirect_url: string; connected_account_id: string }>(
    'POST',
    '/connected_accounts/link',
    { auth_config_id: await trelloAuthConfig(), user_id: userId, callback_url: callbackUrl },
  )

  if (
    typeof link.connected_account_id !== 'string' ||
    !/^ca_[A-Za-z0-9_-]+$/u.test(link.connected_account_id)
  )
    throw new AppError(502, 'trello_invalid_account', 'Invalid Trello connected account')
  let redirect: URL

  try {
    redirect = new URL(link.redirect_url)
  } catch {
    throw new AppError(502, 'trello_invalid_link', 'Invalid Trello connection link')
  }

  if (
    redirect.protocol !== 'https:' ||
    redirect.hostname !== 'connect.composio.dev' ||
    redirect.port ||
    redirect.username ||
    redirect.password
  ) {
    throw new AppError(502, 'trello_invalid_link', 'Invalid Trello connection link')
  }

  return { authorizeUrl: redirect.href, accountId: link.connected_account_id }
}

export async function verifyTrelloConnection(accountId: string, userId: string) {
  const account = await composioRequest<{
    user_id?: string
    status?: string
    toolkit?: { slug?: string }
    auth_config?: { id?: string }
  }>('GET', `/connected_accounts/${encodeURIComponent(accountId)}`)

  if (
    account.status !== 'ACTIVE' ||
    account.user_id !== userId ||
    account.toolkit?.slug !== 'trello' ||
    account.auth_config?.id !== (await trelloAuthConfig())
  ) {
    throw new AppError(
      403,
      'trello_reconnect_required',
      'Trello connection is inactive or does not match this authorization',
    )
  }
}

export async function executeTrelloTool(
  accountId: string,
  userId: string,
  tool: string,
  args: Record<string, unknown>,
) {
  if (!TRELLO_TOOLS.has(tool))
    throw new AppError(400, 'trello_tool_not_allowed', 'Unsupported Trello tool')
  const toolArguments = trelloToolArguments(tool, args)

  await verifyTrelloConnection(accountId, userId)
  const result = await composioRequest<{ successful: boolean; data: unknown; log_id?: unknown }>(
    'POST',
    `/tools/execute/${tool}`,
    {
      connected_account_id: accountId,
      user_id: userId,
      arguments: toolArguments,
      version: VERSION,
    },
  )

  if (!result.successful)
    throw new AppError(
      502,
      'trello_tool_failed',
      // The upstream error text can echo request URLs, so only Composio's log id goes out:
      // it finds the exact failure in the Composio dashboard's logs.
      `Trello denied or could not complete this operation (Composio log ${typeof result.log_id === 'string' ? result.log_id : 'unavailable'}). Do not automatically retry a write.`,
    )

  return { successful: true, data: result.data }
}
