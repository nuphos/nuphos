import { ipcRenderer } from 'electron'

import type { WebhookInput } from '../../src/types/webhooks'

export const webhooksApi = {
  atlasListWebhooks: (teamId: string) => ipcRenderer.invoke('atlas:listWebhooks', teamId),
  atlasCreateWebhook: (teamId: string, input: WebhookInput) =>
    ipcRenderer.invoke('atlas:createWebhook', teamId, input),
  atlasUpdateWebhook: (teamId: string, webhookId: string, input: Partial<WebhookInput>) =>
    ipcRenderer.invoke('atlas:updateWebhook', teamId, webhookId, input),
  atlasDeleteWebhook: (teamId: string, webhookId: string) =>
    ipcRenderer.invoke('atlas:deleteWebhook', teamId, webhookId),
  atlasTestWebhook: (teamId: string, webhookId: string) =>
    ipcRenderer.invoke('atlas:testWebhook', teamId, webhookId),
}
