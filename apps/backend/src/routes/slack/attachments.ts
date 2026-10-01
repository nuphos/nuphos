import { ObjectId } from 'mongodb'

import {
  INBOUND_FILE_FAILURE_NOTE,
  ingestInboundFiles,
  renderInboundFileInstruction,
  renderInboundImagePart,
} from '@/lib/agent/inbound-files'
import { listSessionDownloadsSince } from '@/lib/file-transfer/service'
import { logError, logEvent } from '@/lib/observability'
import { downloadSlackFile } from '@/lib/slack/api'
import { shareTransferGroupsToSlackThread } from '@/lib/slack/files'

import type { InboundFile } from '@/lib/agent/inbound-files'
import type { SlackMessageEvent, SlackRuntime } from '@/routes/slack/types'

// A Slack attachment above this stays pull-only from the transfer store; the
// store's own ceilings still apply on top (config.fileTransfer).
const MAX_SLACK_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Downloads whatever the user attached and puts it in the transfer store, so
// the turn can tell the agent where to pull it from. Returns the text to append
// to the rendered message plus any vision parts. Never throws: an unreadable
// attachment degrades to a note, because the message text is usually still
// answerable ("why does this fail?" + a log file we could not fetch is worth a
// reply saying so).
export async function ingestSlackAttachments(args: {
  runtime: SlackRuntime
  event: SlackMessageEvent
  teamId: string
  userId: string
  sessionId: string
}): Promise<{ note: string; parts: unknown[] }> {
  const attached = args.event.files ?? []
  const refs = attached.filter((file) => file.url_private)

  if (attached.length === 0) return { note: '', parts: [] }
  // Files were attached but none of them is fetchable. Slack drops
  // url_private from the file object when the bot token lacks files:read —
  // a workspace installed before that scope was added still has such a token.
  // Returning silently here made that case indistinguishable from "no
  // attachment": the agent saw a message with no text and no explanation, so
  // it could not even tell the user it had missed the file.
  if (refs.length === 0) {
    logEvent('warn', 'slack.agent.attachments_unreadable', {
      team_id: args.teamId,
      session_id: args.sessionId,
      slack_channel_id: args.event.channel,
      attached_count: attached.length,
      // The likely cause, and the one that needs a re-install to fix.
      missing_url_private: true,
    })

    return { note: INBOUND_FILE_FAILURE_NOTE, parts: [] }
  }

  const downloaded: InboundFile[] = []
  let failed = 0

  for (const ref of refs) {
    try {
      const file = await downloadSlackFile({
        token: args.runtime.botToken,
        urlPrivate: ref.url_private!,
        maxBytes: MAX_SLACK_ATTACHMENT_BYTES,
      })

      if (!file) {
        failed++
        continue
      }
      downloaded.push({
        fileName: ref.name || ref.title || `${ref.id ?? 'attachment'}.${ref.filetype ?? 'bin'}`,
        contentType: file.contentType ?? ref.mimetype ?? null,
        bytes: file.bytes,
      })
    } catch (err) {
      failed++
      logError('slack.files.download.error', err, {
        slack_channel_id: args.event.channel,
        slack_file_id: ref.id,
      })
    }
  }

  const ingested = await ingestInboundFiles({
    teamId: args.teamId,
    userId: args.userId,
    sessionId: args.sessionId,
    files: downloaded,
    label: 'Slack attachment',
  })

  logEvent('info', 'slack.agent.attachments_ingested', {
    team_id: args.teamId,
    session_id: args.sessionId,
    attached_count: refs.length,
    stored_count: ingested?.fileNames.length ?? 0,
    failed_count: failed,
  })

  const notes: string[] = []

  if (ingested) notes.push(renderInboundFileInstruction(ingested))
  if (failed > 0 || (downloaded.length > 0 && !ingested)) notes.push(INBOUND_FILE_FAILURE_NOTE)

  return {
    note: notes.join('\n'),
    parts: downloaded
      .map((file) => renderInboundImagePart(file))
      .filter((part): part is NonNullable<typeof part> => part !== null),
  }
}

// Files the agent pushed to the transfer store during this turn (download
// groups scoped to the session) get mirrored into the thread as native Slack
// attachments. Best-effort like plan cards: a failed attachment must not fail
// the turn (the desktop download card still exists either way).
export async function postAgentProducedFiles(args: {
  runtime: SlackRuntime
  channel: string
  threadTs: string
  teamId: string
  sessionId: string
  since: Date
}): Promise<void> {
  try {
    const groups = await listSessionDownloadsSince({
      teamId: new ObjectId(args.teamId),
      sessionId: args.sessionId,
      since: args.since,
    })

    if (groups.length === 0) return
    await shareTransferGroupsToSlackThread({
      token: args.runtime.botToken,
      channel: args.channel,
      threadTs: args.threadTs,
      groups,
    })
  } catch (err) {
    logError('slack.files.share.error', err, {
      session_id: args.sessionId,
      slack_channel_id: args.channel,
      slack_thread_ts: args.threadTs,
    })
  }
}
