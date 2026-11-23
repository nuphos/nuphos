import { call } from './client'

import type {
  TeamWebhook,
  WebhookInput,
  WebhookListing,
  WebhookTestResult,
} from '../../src/types/webhooks'

function path(teamId: string, webhookId?: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/webhooks`

  return webhookId ? `${base}/${encodeURIComponent(webhookId)}` : base
}

export function listWebhooks(teamId: string): Promise<WebhookListing> {
  return call<WebhookListing>('GET', path(teamId))
}

export async function createWebhook(teamId: string, input: WebhookInput): Promise<TeamWebhook> {
  const res = await call<{ webhook: TeamWebhook }>('POST', path(teamId), input, { retry: false })

  return res.webhook
}

export async function updateWebhook(
  teamId: string,
  webhookId: string,
  input: Partial<WebhookInput>,
): Promise<TeamWebhook> {
  const res = await call<{ webhook: TeamWebhook }>('PATCH', path(teamId, webhookId), input, {
    retry: false,
  })

  return res.webhook
}

export async function deleteWebhook(teamId: string, webhookId: string): Promise<void> {
  await call('DELETE', path(teamId, webhookId), undefined, { retry: false })
}

export function testWebhook(teamId: string, webhookId: string): Promise<WebhookTestResult> {
  return call<WebhookTestResult>('POST', `${path(teamId, webhookId)}/test`, undefined, {
    retry: false,
  })
}
