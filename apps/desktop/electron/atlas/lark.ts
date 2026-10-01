import { call } from './client'

export type LarkDomain = 'feishu' | 'larksuite'

export type LarkChatMapping = {
  id: string
  appId: string
  chatId: string
  teamId: string
  name?: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type LarkAvailableChat = {
  chatId: string
  name: string
  description?: string
  linked: boolean
  enabled: boolean
}

export type LarkUserMapping = {
  id: string
  appId: string
  larkOpenId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type LarkPairCode = {
  code: string
  expiresAt: string
}

export type LarkBindInput = {
  appId: string
  appSecret: string
  encryptKey: string
  domain: LarkDomain
}

export type LarkInstallation = {
  id: string
  appId: string
  domain: LarkDomain
  tenantName: string | null
  createdAt: string
}

export type LarkConnectionStatus = {
  installed?: boolean
  connected: boolean
  appId?: string
  domain?: LarkDomain
  webhookUrl?: string
}

export async function getLarkInstallation(
  teamId: string,
): Promise<{ installation: LarkInstallation | null; webhookUrl: string | null }> {
  return call<{ installation: LarkInstallation | null; webhookUrl: string | null }>(
    'GET',
    `/teams/${teamId}/lark-installations`,
  )
}

export async function getLarkConnectionStatus(teamId: string): Promise<LarkConnectionStatus> {
  return call<LarkConnectionStatus>('GET', `/teams/${teamId}/lark-installations/status`)
}

// Custom-app-only: submit the team's own Feishu / Lark custom-app credentials.
// The backend verifies them (mints a tenant_access_token) before storing.
export async function bindLark(
  teamId: string,
  input: LarkBindInput,
): Promise<{ installation: LarkInstallation; webhookUrl: string }> {
  return call<{ installation: LarkInstallation; webhookUrl: string }>(
    'PUT',
    `/teams/${teamId}/lark-installations`,
    input,
    { retry: false },
  )
}

export async function disconnectLark(teamId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/lark-installations`, undefined, { retry: false })
}

export async function listLarkChatMappings(teamId: string): Promise<LarkChatMapping[]> {
  const data = await call<{ mappings: LarkChatMapping[] }>(
    'GET',
    `/lark/mappings?teamId=${encodeURIComponent(teamId)}`,
  )

  return data.mappings ?? []
}

export async function upsertLarkChatMapping(
  teamId: string,
  input: { chatId: string; enabled?: boolean; name?: string },
): Promise<LarkChatMapping> {
  const data = await call<{ mapping: LarkChatMapping }>(
    'PUT',
    '/lark/mappings',
    { teamId, ...input },
    { retry: false },
  )

  return data.mapping
}

export async function listLarkAvailableChats(teamId: string): Promise<LarkAvailableChat[]> {
  const data = await call<{ chats: LarkAvailableChat[] }>(
    'GET',
    `/lark/available-chats?teamId=${encodeURIComponent(teamId)}`,
  )

  return data.chats ?? []
}

export async function deleteLarkChatMapping(teamId: string, chatId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/lark/mappings/${encodeURIComponent(chatId)}?teamId=${encodeURIComponent(teamId)}`,
    undefined,
    { retry: false },
  )
}

export async function listLarkUserMappings(teamId: string): Promise<LarkUserMapping[]> {
  const data = await call<{ mappings: LarkUserMapping[] }>(
    'GET',
    `/lark/user-mappings?teamId=${encodeURIComponent(teamId)}`,
  )

  return data.mappings ?? []
}

export async function deleteLarkUserMapping(teamId: string, openId: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/lark/user-mappings/${encodeURIComponent(openId)}?teamId=${encodeURIComponent(teamId)}`,
    undefined,
    { retry: false },
  )
}

export async function createLarkPairCode(teamId: string): Promise<LarkPairCode> {
  return await call<LarkPairCode>('POST', '/lark/pair-code', { teamId }, { retry: false })
}
