import { config } from '@/config'
import { composioRequest } from '@/lib/composio'
import { AppError } from '@/lib/errors'

const VERSION = '20261104_00'

const TOOL_FIELDS: Record<string, readonly string[]> = {
  TRELLO_GET_MEMBERS_BY_ID_MEMBER: ['idMember', 'fields'],
  TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER: ['idMember', 'fields', 'filter'],
  TRELLO_GET_BOARDS_BY_ID_BOARD: ['idBoard', 'fields'],
  TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD: ['idBoard', 'fields', 'filter'],
  TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD: ['idBoard', 'fields', 'limit', 'before'],
  TRELLO_GET_LISTS_CARDS_BY_ID_LIST: ['idList', 'fields', 'limit', 'before'],
  TRELLO_GET_CARDS_BY_ID_CARD: ['idCard', 'fields'],
  TRELLO_ADD_LISTS: ['name', 'idBoard', 'pos'],
  TRELLO_UPDATE_LISTS_BY_ID_LIST: ['idList', 'name', 'closed', 'pos'],
  TRELLO_ADD_CARDS: ['name', 'desc', 'idList', 'due', 'pos'],
  TRELLO_UPDATE_CARDS_BY_ID_CARD: ['idCard', 'name', 'desc', 'closed', 'due', 'pos'],
  TRELLO_UPDATE_CARDS_ID_LIST_BY_ID_CARD: ['idCard', 'value'],
  TRELLO_ADD_CARDS_ACTIONS_COMMENTS_BY_ID_CARD: ['idCard', 'text'],
}

export const TRELLO_TOOLS = new Set(Object.keys(TOOL_FIELDS))

export function trelloToolArguments(tool: string, args: Record<string, unknown>) {
  const allowed = TOOL_FIELDS[tool]

  if (!allowed || Object.keys(args).some((field) => !allowed.includes(field))) {
    throw new AppError(400, 'trello_arguments_not_allowed', 'Unsupported Trello tool arguments')
  }
  if (tool === 'TRELLO_GET_MEMBERS_BY_ID_MEMBER') return { ...args, fields: 'id,username' }
  if (
    tool === 'TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD' ||
    tool === 'TRELLO_GET_LISTS_CARDS_BY_ID_LIST'
  ) {
    const limit = args.limit ?? 100

    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(400, 'trello_page_too_large', 'Trello card pages must contain 1–100 items')
    }

    return { ...args, limit }
  }

  return args
}

export function trelloAuthConfig(): string {
  const { apiKey, trelloAuthConfigId } = config.byos.composio

  if (!apiKey || !trelloAuthConfigId) {
    throw new AppError(
      503,
      'trello_not_configured',
      'Trello connection is not configured on this server',
    )
  }

  return trelloAuthConfigId
}

export async function trelloConnectLink(userId: string, callbackUrl: string) {
  const link = await composioRequest<{ redirect_url: string; connected_account_id: string }>(
    'POST',
    '/connected_accounts/link',
    { auth_config_id: trelloAuthConfig(), user_id: userId, callback_url: callbackUrl },
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
    account.auth_config?.id !== trelloAuthConfig()
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
  const result = await composioRequest<{ successful: boolean; data: unknown; error?: unknown }>(
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
      'Trello denied or could not complete this operation. Do not automatically retry a write.',
    )

  return { successful: true, data: result.data }
}
