export type WebhookEvent =
  'session.turn.completed' | 'session.turn.failed' | 'session.input_required' | 'task.reported'

export type WebhookAttempt = {
  at: string
  status: number | null
  ok: boolean
  error?: string
  type: string
}

export type TeamWebhook = {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  /** Header names only; their values never leave the backend. */
  headers: string[]
  enabled: boolean
  /** Why delivery switched the endpoint off, until someone switches it back on. */
  disabledReason: string | null
  lastDelivery: WebhookAttempt | null
  createdAt: string
  updatedAt: string
}

export type WebhookListing = { webhooks: TeamWebhook[]; events: WebhookEvent[] }

export type WebhookInput = {
  name: string
  url: string
  events: WebhookEvent[]
  /** The full list. On update, a header without a value keeps its stored one. */
  headers: { name: string; value?: string }[]
  enabled?: boolean
}

export type WebhookTestResult = { ok: boolean; status: number | null; error: string | null }
