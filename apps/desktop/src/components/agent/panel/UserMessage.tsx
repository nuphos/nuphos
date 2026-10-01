import { memo, useCallback, useMemo } from 'react'

import { parseAtlasLink } from '../../../lib/atlasLinkMention'
import { trustedAvatarURL } from '../../../lib/avatarUrl'
import { Avatar } from '../../Avatar'
import { MessageResponse } from '../MessageResponse'
import { PlanCard } from '../PlanTool'

import { CopyMessageButton } from './messageActions'
import { ImageAttachmentThumb, LocalFileChip } from './messageInline'
import { renderAtlasMentionLink } from './messageInlineLinks'
import { formatMessageTimestamp } from './streamText'
import { UploadedFilesCard } from './transferCards'
import { useSentMessageMotion } from './useSentMessageMotion'

import type { Message } from './model'
import type { ImageAttachmentPart, LocalFilePart, TextPart, TransferUploadPart } from './parts'
import type { ReactNode } from 'react'

// Pull plan references out of message text. The composer serializes a plan
// mention chip back to its Nuphos URL (`…/teams/T/plans/<n>`), so a sent
// message carries the URL as plain text; parse those out so we can render the
// referenced plan inline. Deduped by planId, first-seen order preserved.
const PLAN_MENTION_TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', ']', ')', '>', '}'])

function extractPlanMentions(text: string): { planId: string; teamId: string }[] {
  const out: { planId: string; teamId: string }[] = []
  const seen = new Set<string>()
  const re = /https:\/\/nuphos\.ai\/\S+/g
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    let urlEnd = m[0].length

    while (urlEnd > 0 && PLAN_MENTION_TRAILING_PUNCT.has(m[0][urlEnd - 1])) urlEnd--
    const url = m[0].slice(0, urlEnd)
    const target = parseAtlasLink(url)

    if (target?.type !== 'plan') continue
    if (seen.has(target.planId)) continue
    seen.add(target.planId)
    out.push({ planId: target.planId, teamId: target.teamId })
  }

  return out
}

export const UserMessage = memo(
  ({
    message,
    onApprovePlan,
    onRejectPlan,
    canActOnPlans = false,
    onOpenNuphosLink,
  }: {
    message: Message
    onApprovePlan?: (planId: string) => void
    onRejectPlan?: (planId: string, reason: string, mode: 'revise' | 'delete') => void
    /** Whether a referenced `proposed` plan can be acted on (not streaming/read-only).
     *  This is what lets a historical plan be pulled into chat and executed. */
    canActOnPlans?: boolean
    onOpenNuphosLink?: (href: string) => boolean
  }) => {
    const sendMotionRef = useSentMessageMotion(message.id)
    const renderLink = useCallback(
      (href: string, children: ReactNode) =>
        renderAtlasMentionLink(href, children, onOpenNuphosLink),
      [onOpenNuphosLink],
    )
    const textParts = message.parts.filter((p): p is TextPart => p.type === 'text')
    const files = message.parts.filter((p): p is LocalFilePart => p.type === 'local-file')
    const images = message.parts.filter((p): p is ImageAttachmentPart => p.type === 'image')
    const uploads = message.parts.filter(
      (p): p is TransferUploadPart => p.type === 'transfer-upload',
    )
    // Plans the user referenced in this message — render each as an inline card.
    const planMentions = useMemo(() => {
      const all = textParts.flatMap((p) => extractPlanMentions(p.text))
      const seen = new Set<string>()

      return all.filter((p) => (seen.has(p.planId) ? false : (seen.add(p.planId), true)))
    }, [textParts])
    const copyableText = textParts
      .map((p) => p.text)
      .join('\n\n')
      .trim()

    return (
      <div ref={sendMotionRef} className="group/message flex flex-col items-end gap-2">
        <div className="flex w-full items-start justify-end gap-2.5">
          <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-2">
            {message.metadata && (
              <div className="flex max-w-full items-center gap-2 px-1 text-xs leading-4">
                <span
                  className="truncate font-medium text-secondary"
                  title={message.metadata.sender.displayName}
                >
                  {message.metadata.sender.displayName}
                </span>
                {message.metadata.source === 'slack' && (
                  <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-tertiary">
                    Slack
                  </span>
                )}
              </div>
            )}
            {images.length > 0 && (
              <div className="max-w-full flex flex-wrap justify-end gap-1.5 pr-1">
                {images.map((p, i) => (
                  <ImageAttachmentThumb
                    key={`${p.fileName}:${String(i)}`}
                    url={p.url}
                    fileName={p.fileName}
                  />
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="max-w-full flex flex-wrap justify-end gap-1.5 pr-1">
                {files.map((p) => (
                  <LocalFileChip key={p.path} path={p.path} />
                ))}
              </div>
            )}
            {uploads.map((p) => (
              <UploadedFilesCard key={p.groupId} part={p} />
            ))}
            {textParts.length > 0 && (
              <div className="user-message-bubble max-w-full rounded-2xl rounded-tr-md px-3.5 py-2 break-words space-y-2">
                {textParts.map((p, i) => (
                  <MessageResponse
                    key={i}
                    // Markdown collapses single newlines; pre-wrap keeps the user's
                    // line breaks visible without turning them into paragraphs.
                    className="[&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap"
                    renderLink={renderLink}
                    onLinkClick={onOpenNuphosLink}
                  >
                    {p.text}
                  </MessageResponse>
                ))}
              </div>
            )}
            {(copyableText || typeof message.createdAt === 'number') && (
              <div className="-mt-1 flex min-h-7 items-center justify-end gap-1 opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 transition-opacity">
                {typeof message.createdAt === 'number' && (
                  <span className="pr-0.5 text-[11px] text-tertiary tabular-nums">
                    {formatMessageTimestamp(message.createdAt)}
                  </span>
                )}
                {copyableText && <CopyMessageButton text={copyableText} label="Copy message" />}
              </div>
            )}
          </div>
          {message.metadata && (
            <div className="mt-6 shrink-0" aria-hidden="true">
              <Avatar
                src={trustedAvatarURL(message.metadata.sender.avatarURL)}
                name={message.metadata.sender.displayName}
                size={28}
                className="rounded-full ring-1 ring-black/5 dark:ring-white/10"
              />
            </div>
          )}
        </div>
        {planMentions.map(({ planId, teamId }) => (
          <div key={planId} className="w-full">
            <PlanCard
              planId={planId}
              teamId={teamId}
              // A referenced plan can be pulled back into context and run: when
              // it's still `proposed` (PlanCard gates that internally) and the
              // tab is idle, Approve / Reject act on it just like a fresh plan.
              // The backend scopes team plans by team, so any member can run it.
              canApprove={canActOnPlans}
              onApprove={onApprovePlan ? () => onApprovePlan(planId) : undefined}
              onReject={
                onRejectPlan ? (reason, mode) => onRejectPlan(planId, reason, mode) : undefined
              }
              canChat={false}
              foldable
            />
          </div>
        ))}
      </div>
    )
  },
)
