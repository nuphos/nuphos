import type {
  TeamWebhook,
  WebhookInput,
  WebhookListing,
  WebhookTestResult,
} from '../types/webhooks'

export type WindowWebhooksApi = {
  atlasListWebhooks(teamId: string): Promise<WebhookListing>
  atlasCreateWebhook(teamId: string, input: WebhookInput): Promise<TeamWebhook>
  atlasUpdateWebhook(
    teamId: string,
    webhookId: string,
    input: Partial<WebhookInput>,
  ): Promise<TeamWebhook>
  atlasDeleteWebhook(teamId: string, webhookId: string): Promise<void>
  atlasTestWebhook(teamId: string, webhookId: string): Promise<WebhookTestResult>
}
