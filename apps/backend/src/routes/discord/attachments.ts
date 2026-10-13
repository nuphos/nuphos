import { ObjectId } from 'mongodb'

import {
  INBOUND_FILE_FAILURE_NOTE,
  ingestInboundFiles,
  readBoundedBody,
  renderInboundFileInstruction,
} from '@/lib/agent/inbound-files'
import { discordApi, sendDiscordMessage } from '@/lib/discord/api'
import { listSessionDownloadsSince } from '@/lib/file-transfer/service'
import { logError, logEvent } from '@/lib/observability'

import type { InboundFile } from '@/lib/agent/inbound-files'

export type DiscordAttachment = { filename: string; url: string; content_type?: string }

// A Discord attachment above this is not fetched; the store's own ceilings
// still apply on top (config.fileTransfer).
const MAX_INBOUND_BYTES = 25 * 1024 * 1024
// What a bot may upload to a server without boosts.
const MAX_OUTBOUND_BYTES = 10 * 1024 * 1024
const TRANSFER_TIMEOUT_MS = 120_000
// Attachments are served from Discord's own CDN; nothing else is fetched.
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])

async function fetchBytes(url: string, maxBytes: number): Promise<Uint8Array | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) })

  return response.ok ? await readBoundedBody(response, maxBytes) : null
}

// Puts whatever the user attached into the transfer store and returns the
// text that tells the agent where to pull it from. Never throws: an unreadable
// attachment degrades to a note, because the message is usually still
// answerable.
export async function ingestDiscordAttachments(args: {
  attachments: DiscordAttachment[] | undefined
  teamId: string
  userId: string
  sessionId: string
}): Promise<string> {
  const attached = args.attachments ?? []

  if (attached.length === 0) return ''
  const downloaded: InboundFile[] = []

  for (const file of attached) {
    try {
      const bytes = CDN_HOSTS.has(new URL(file.url).hostname)
        ? await fetchBytes(file.url, MAX_INBOUND_BYTES)
        : null

      if (bytes) {
        downloaded.push({ fileName: file.filename, contentType: file.content_type, bytes })
      }
    } catch (err) {
      logError('discord.files.download.error', err, { session_id: args.sessionId })
    }
  }
  const ingested = await ingestInboundFiles({
    teamId: args.teamId,
    userId: args.userId,
    sessionId: args.sessionId,
    files: downloaded,
    label: 'Discord attachment',
  })
  const stored = ingested?.fileNames.length ?? 0

  logEvent('info', 'discord.agent.attachments_ingested', {
    team_id: args.teamId,
    session_id: args.sessionId,
    attached_count: attached.length,
    stored_count: stored,
  })

  return [
    ingested ? renderInboundFileInstruction(ingested) : '',
    stored < attached.length ? INBOUND_FILE_FAILURE_NOTE : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// Files the agent pushed to the transfer store during this turn are attached
// to the thread. Best-effort and never rejects: a failed attachment must not
// fail the turn, and the download card in the Nuphos app exists either way.
export async function postAgentProducedDiscordFiles(args: {
  channelId: string
  teamId: string
  sessionId: string
  since: Date
  isConnected: () => Promise<boolean>
}): Promise<void> {
  try {
    const groups = await listSessionDownloadsSince({
      teamId: new ObjectId(args.teamId),
      sessionId: args.sessionId,
      since: args.since,
    })
    const files = groups.flatMap((group) =>
      group.files.filter((file) => file.status === 'ready' && file.downloadUrl),
    )

    if (files.length === 0 || !(await args.isConnected())) return
    const unattached: string[] = []

    for (const file of files) {
      try {
        const bytes =
          (file.size ?? 0) > MAX_OUTBOUND_BYTES
            ? null
            : await fetchBytes(file.downloadUrl!, MAX_OUTBOUND_BYTES)

        if (!bytes) {
          unattached.push(file.fileName)
          continue
        }
        const form = new FormData()

        form.append('payload_json', JSON.stringify({ allowed_mentions: { parse: [] } }))
        form.append('files[0]', new Blob([bytes.slice().buffer as ArrayBuffer]), file.fileName)
        await discordApi(`/channels/${args.channelId}/messages`, { method: 'POST', body: form })
      } catch (err) {
        logError('discord.files.attach_error', err, {
          session_id: args.sessionId,
          discord_thread_id: args.channelId,
        })
        unattached.push(file.fileName)
      }
    }
    if (unattached.length > 0) {
      await sendDiscordMessage(
        args.channelId,
        `I could not attach ${unattached.join(', ')} here. Download from the conversation in the Nuphos app.`,
      )
    }
  } catch (err) {
    logError('discord.files.share.error', err, {
      session_id: args.sessionId,
      discord_thread_id: args.channelId,
    })
  }
}
