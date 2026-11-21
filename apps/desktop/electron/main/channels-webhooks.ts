import * as atlas from '../atlas'

import type { WebhookInput } from '../../src/types/webhooks'

export const webhooksChannels = {
  'atlas:listWebhooks': (_e: unknown, teamId: string) => atlas.listWebhooks(teamId),
  'atlas:createWebhook': (_e: unknown, teamId: string, input: WebhookInput) =>
    atlas.createWebhook(teamId, input),
  'atlas:updateWebhook': (
    _e: unknown,
    teamId: string,
    webhookId: string,
    input: Partial<WebhookInput>,
  ) => atlas.updateWebhook(teamId, webhookId, input),
  'atlas:deleteWebhook': (_e: unknown, teamId: string, webhookId: string) =>
    atlas.deleteWebhook(teamId, webhookId),
  'atlas:testWebhook': (_e: unknown, teamId: string, webhookId: string) =>
    atlas.testWebhook(teamId, webhookId),
}
