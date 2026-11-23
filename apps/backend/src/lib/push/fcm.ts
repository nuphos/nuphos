import { GoogleAuth } from 'google-auth-library'

import { config } from '@/config'

import type { notificationIdentity } from './notification-identity'

export type FcmRequest = {
  token: string
  userId: string
  badge?: number
  teamId: string
  sessionId: string
  title: string
  subtitle?: string // Android shows one title line: it follows the title.
  body: string
  agentIdentity?: ReturnType<typeof notificationIdentity>
}
export type FcmResponse = { status: number; deadToken: boolean }
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })

export function fcmProjectId(): string | null {
  return config.fcm.projectId ?? null
}

/** FCM data values are strings: a Bot's face, as the iOS push carries in `agentIdentity`. */
function botIdentity(identity: FcmRequest['agentIdentity']): Record<string, string> {
  if (!identity?.isBot || !identity.avatar) return {}

  return {
    botAvatar: identity.avatar,
    ...(identity.provider ? { botProvider: identity.provider } : {}),
  }
}

export function fcmMessage(request: FcmRequest) {
  return {
    message: {
      token: request.token,
      data: {
        accountId: request.userId,
        teamId: request.teamId,
        sessionId: request.sessionId,
        title: request.subtitle ? `${request.title} · ${request.subtitle}` : request.title,
        body: request.body,
        ...(request.badge !== undefined ? { badge: String(request.badge) } : {}),
        ...botIdentity(request.agentIdentity),
      },
      android: { priority: 'HIGH', ttl: '3600s', collapse_key: request.sessionId },
    },
  }
}

export async function sendFcmBadge(
  projectId: string,
  token: string,
  userId: string,
  badge: number,
): Promise<FcmResponse> {
  return sendMessage(projectId, {
    message: {
      token,
      data: { accountId: userId, kind: 'badge', badge: String(badge) },
      android: { priority: 'NORMAL', ttl: '3600s', collapse_key: 'badge' },
    },
  })
}

export async function sendFcmComputerAlert(
  projectId: string,
  token: string,
  accountId: string,
  change: { deviceId: string; title: string; body: string },
): Promise<FcmResponse> {
  return sendMessage(projectId, {
    message: {
      token,
      data: {
        accountId,
        kind: 'computer',
        computerId: change.deviceId,
        title: change.title,
        body: change.body,
      },
      android: { priority: 'HIGH', ttl: '3600s', collapse_key: `computer:${change.deviceId}` },
    },
  })
}

export async function sendFcm(projectId: string, request: FcmRequest): Promise<FcmResponse> {
  return sendMessage(projectId, fcmMessage(request))
}

async function sendMessage(projectId: string, message: unknown): Promise<FcmResponse> {
  const token = await auth.getAccessToken()

  if (!token) throw new Error('FCM ADC authentication unavailable')
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    },
  )
  const body = (await response.json().catch(() => null)) as {
    error?: { details?: { '@type'?: string; errorCode?: string }[] }
  } | null
  const deadToken = isDeadFcmToken(body)

  return { status: response.status, deadToken }
}

/** Payload/permission errors must not destroy a valid registration. */
export function isDeadFcmToken(
  body: {
    error?: { details?: { '@type'?: string; errorCode?: string }[] }
  } | null,
): boolean {
  return (
    body?.error?.details?.some(
      (detail) =>
        detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
        detail.errorCode === 'UNREGISTERED',
    ) ?? false
  )
}
