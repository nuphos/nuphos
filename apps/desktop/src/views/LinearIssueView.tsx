import { useEffect } from 'react'

import { MessageResponse } from '../components/agent/MessageResponse'
import { Avatar } from '../components/Avatar'
import { LinearMark } from '../components/LinearMark'
import { Button } from '../components/ui/button'

import { normalizeHexColor } from './linear/linearColor'
import { StateBadge, Timestamp } from './linear/linearParts'
import { LinearReconnectPrompt } from './linear/LinearReconnect'
import { openOnLinear } from './openOnLinear'
import { useLinearIssue } from './useLinearIssue'

import type { LinearIssueDetail } from '../types'
import type { ReactNode } from 'react'

type Props = {
  teamId: string
  bindingId: string
  identifier: string
  refreshKey: number
  onLoaded: (issue: LinearIssueDetail) => void
  onCount: (count: number) => void
}

function fallbackLinearUrl(identifier: string): string {
  return `https://linear.app/issue/${identifier}`
}

function LabelChip({ name, color }: { name: string; color: string }) {
  const hex = normalizeHexColor(color)

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-zGray-800/60 px-2 py-0.5 text-[11.5px] font-medium text-main"
      style={hex ? { backgroundColor: `${hex}26` } : undefined}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-zGray-500"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      <span className="truncate">{name}</span>
    </span>
  )
}

function OpenInLinearButton({ url }: { url: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => openOnLinear(url)}>
      <LinearMark size={14} />
      Open in Linear
    </Button>
  )
}

function MetaItem({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5">{children}</span>
}

function LinearIssueContent({ issue }: { issue: LinearIssueDetail }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-zGray-800/70">
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-3 @xl:px-6 @xl:py-4">
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-tertiary">{issue.identifier}</div>
            <h1 className="break-words text-[17px] font-semibold leading-6 text-main">
              {issue.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-secondary">
            <StateBadge state={issue.state} />
            <MetaItem>
              {issue.assignee ? (
                <>
                  <Avatar
                    src={issue.assignee.avatarUrl}
                    name={issue.assignee.name}
                    size={16}
                    className="rounded-full"
                  />
                  <span className="truncate">{issue.assignee.name}</span>
                </>
              ) : (
                <span className="text-tertiary">Unassigned</span>
              )}
            </MetaItem>
            <MetaItem>{issue.priorityLabel}</MetaItem>
            {issue.project && <MetaItem>{issue.project}</MetaItem>}
            {issue.cycle && <MetaItem>{issue.cycle}</MetaItem>}
            <MetaItem>
              <span className="text-tertiary">Updated</span>
              <Timestamp value={issue.updatedAt} />
            </MetaItem>
          </div>
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {issue.labels.map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} />
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 @xl:px-6 @xl:py-6">
          {issue.description?.trim() ? (
            <MessageResponse className="text-[13px]" streaming={false}>
              {issue.description}
            </MessageResponse>
          ) : (
            <div className="text-[12px] italic text-tertiary">No description provided.</div>
          )}

          {issue.comments.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[12px] font-medium text-tertiary">
                {issue.comments.length === 1
                  ? '1 comment'
                  : `${String(issue.comments.length)} comments`}
              </h2>
              {issue.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="space-y-2 rounded-lg border border-zGray-800/40 bg-appBg/60 px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-[12px] text-tertiary">
                    <Avatar
                      src={comment.authorAvatarUrl}
                      name={comment.author}
                      size={20}
                      className="shrink-0 rounded-full"
                    />
                    <span className="truncate">
                      <span className="font-medium text-main">{comment.author}</span>{' '}
                      <Timestamp value={comment.createdAt} />
                    </span>
                  </div>
                  <MessageResponse className="text-[13px]" streaming={false}>
                    {comment.body}
                  </MessageResponse>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export function LinearIssueView({
  teamId,
  bindingId,
  identifier,
  refreshKey,
  onLoaded,
  onCount,
}: Props) {
  const { state, reload } = useLinearIssue(teamId, bindingId, identifier, refreshKey)

  useEffect(() => onCount(0), [onCount])
  useEffect(() => {
    if (state.kind === 'loaded') onLoaded(state.issue)
  }, [onLoaded, state])

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-tertiary">
        Loading…
      </div>
    )
  }
  if (state.kind === 'not-found') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-[12.5px] text-secondary">Issue not found.</div>
        <OpenInLinearButton url={fallbackLinearUrl(identifier)} />
      </div>
    )
  }
  if (state.kind === 'no-access') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-[12.5px] text-secondary">
          You don&apos;t have access to this Linear workspace.
        </div>
        <OpenInLinearButton url={fallbackLinearUrl(identifier)} />
      </div>
    )
  }
  if (state.kind === 'reconnect') {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <LinearReconnectPrompt teamId={teamId} onReconnected={reload} />
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-[12.5px] text-error">{state.message}</div>
        <OpenInLinearButton url={fallbackLinearUrl(identifier)} />
      </div>
    )
  }

  return <LinearIssueContent issue={state.issue} />
}
