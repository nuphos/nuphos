import type { WebhookInput } from '../types/webhooks'

export const webhooksApi = {
  atlasListWebhooks: (teamId: string) => window.api.atlasListWebhooks(teamId),
  atlasCreateWebhook: (teamId: string, input: WebhookInput) =>
    window.api.atlasCreateWebhook(teamId, input),
  atlasUpdateWebhook: (teamId: string, webhookId: string, input: Partial<WebhookInput>) =>
    window.api.atlasUpdateWebhook(teamId, webhookId, input),
  atlasDeleteWebhook: (teamId: string, webhookId: string) =>
    window.api.atlasDeleteWebhook(teamId, webhookId),
  atlasTestWebhook: (teamId: string, webhookId: string) =>
    window.api.atlasTestWebhook(teamId, webhookId),
}
