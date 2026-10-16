import { AppWindow, ArrowUpRight } from 'lucide-react'

import { isMac } from '../../../lib/platform'
import { ChatLink } from '../MessageResponse'

import type { LocalUrl } from './localUrls'

export type OpenLink = (href: string, beside: boolean) => boolean

const CHIP =
  'group/local inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-md border border-zGray-800 bg-zGray-900/60 pl-1.5 pr-0.5 align-[-0.35em] text-[12.5px] leading-none text-main no-underline transition-colors duration-150 hover:border-zGray-700 hover:bg-zGray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none'

/** A server on this machine, opened in a browser tab with one click. */
export function LocalUrlChip({
  url,
  label,
  onOpen,
}: {
  url: LocalUrl
  /** The author's link text; without it the chip shows the address. */
  label?: string
  onOpen?: OpenLink
}) {
  return (
    <ChatLink
      link={url.href}
      onLinkClick={onOpen}
      className={CHIP}
      title={`Open ${url.href} in a browser tab (${isMac ? '⌘' : 'Ctrl'}-click opens it beside)`}
    >
      <AppWindow aria-hidden className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
      <span
        className={
          label
            ? 'min-w-0 max-w-[32ch] truncate'
            : 'min-w-0 max-w-[32ch] truncate font-mono text-[12px]'
        }
      >
        {label ?? url.label}
      </span>
      <span className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded px-1 text-[11.5px] font-medium text-zViolet-accent transition-colors duration-150 group-hover/local:bg-zViolet-accent/10 motion-reduce:transition-none">
        Open
        <ArrowUpRight aria-hidden className="size-3" strokeWidth={2} />
      </span>
    </ChatLink>
  )
}

/** Servers a local tool started this turn that the answer never linked. */
export function LocalUrlStrip({ urls, onOpen }: { urls: LocalUrl[]; onOpen?: OpenLink }) {
  if (urls.length === 0) return null

  return (
    <div className="t-chat-card-in flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-tertiary">
      <span>Running locally</span>
      {urls.map((url) => (
        <LocalUrlChip key={url.href} url={url} onOpen={onOpen} />
      ))}
    </div>
  )
}
