import { GoogleAuth } from 'google-auth-library'

import { config } from '@/config'

export type FcmRequest = {
  token: string
  userId: string
  teamId: string
  sessionId: string
  title: string
  body: string
}
export type FcmResponse = { status: number; deadToken: boolean }
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })

export function fcmProjectId(): string | null {
  return config.fcm.projectId ?? null
}

export function fcmMessage(request: FcmRequest) {
  return {
    message: {
      token: request.token,
      data: {
        accountId: request.userId,
        teamId: request.teamId,
        sessionId: request.sessionId,
        title: request.title,
        body: request.body,
      },
      android: { priority: 'HIGH', ttl: '3600s', collapse_key: request.sessionId },
    },
  }
}

export async function sendFcm(projectId: string, request: FcmRequest): Promise<FcmResponse> {
  const token = await auth.getAccessToken()

  if (!token) throw new Error('FCM ADC authentication unavailable')
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmMessage(request)),
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
