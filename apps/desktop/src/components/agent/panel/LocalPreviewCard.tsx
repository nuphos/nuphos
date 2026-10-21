import { ArrowUpRight } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { isMac } from '../../../lib/platform'
import { ChatLink } from '../MessageResponse'

import { localPreviewSnapshots } from './localPreviewSnapshots'

import type { OpenLink } from './LocalUrlChip'
import type { LocalUrl } from './localUrls'

const CARD =
  'group/local block w-full max-w-[520px] overflow-hidden rounded-xl border border-zGray-800 bg-main text-main no-underline transition-colors duration-150 hover:border-zGray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none'

/** A captured page above a quiet footer; unopened URLs keep just the footer. */
export function LocalPreviewCard({
  url,
  label,
  teamId,
  onOpen,
}: {
  url: LocalUrl
  label?: string
  teamId?: string
  onOpen?: OpenLink
}) {
  const user = useCurrentUser()
  const scope = user?.id && teamId ? { userId: user.id, teamId } : undefined
  const snapshot = useSyncExternalStore(localPreviewSnapshots.subscribe, () =>
    localPreviewSnapshots.get(scope, url.href),
  )
  const title = label ?? (snapshot?.title ? snapshot.title : 'Local preview')

  return (
    <ChatLink
      link={url.href}
      onLinkClick={onOpen}
      className={CARD}
      title={`Open ${url.href} in a browser tab (${isMac ? '⌘' : 'Ctrl'}-click opens it beside)`}
    >
      {snapshot && (
        <img
          src={snapshot.image}
          alt={`Page preview: ${title}`}
          className="m-0 block aspect-[16/7] w-full border-b border-zGray-800 object-cover object-top"
        />
      )}
      <span className="flex items-center gap-4 px-4 py-3.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 break-words text-[15px] font-medium leading-5">
            {title}
          </span>
          <span className="truncate text-[12.5px] leading-5 text-secondary">{url.label}</span>
        </span>
        <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-zGray-800 px-2 text-[12px] leading-none text-secondary transition-colors duration-150 group-hover/local:bg-zGray-800/40 group-hover/local:text-main group-active/local:bg-zGray-800/60 motion-reduce:transition-none">
          Open
          <ArrowUpRight aria-hidden className="size-3" strokeWidth={1.75} />
        </span>
      </span>
    </ChatLink>
  )
}
