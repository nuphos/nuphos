// A team's webhook endpoint as the backend sees it: https with a certificate made for this run,
// which only the backend this process starts trusts. It records every request it gets.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export type WebhookRequest = {
  headers: IncomingHttpHeaders
  body: {
    id: string
    type: string
    data: { session_id?: string; task_report?: { data?: unknown } }
  }
  status: number
}

const requests: WebhookRequest[] = []
const replies = new Map<string, number>()
let url = ''

export const webhookUrl = () => url
/** What it received, oldest first. */
export const webhookRequests = () => [...requests]
/** The status the next request about `sessionId` gets; 200 after it. */
export const replyWith = (sessionId: string, status: number) => replies.set(sessionId, status)

/** Starts it on a free port; the backend's environment to trust it. */
export async function startWebhookReceiver(): Promise<Record<string, string>> {
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-e2e-webhook-'))
  const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')]
  const subject = ['-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']

  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, ...subject],
    { stdio: 'ignore' },
  )
  const server = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as WebhookRequest['body']
        const status = replies.get(body.data.session_id ?? '') ?? 200

        replies.delete(body.data.session_id ?? '')

        requests.push({ headers: request.headers, body, status })
        response.writeHead(status).end()
      })
    },
  )

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  url = `https://127.0.0.1:${String((server.address() as AddressInfo).port)}/nuphos`

  return { NODE_EXTRA_CA_CERTS: cert }
}
