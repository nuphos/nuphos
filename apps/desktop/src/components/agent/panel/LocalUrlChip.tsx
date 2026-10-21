import { AppWindow, ArrowUpRight } from 'lucide-react'

import { isMac } from '../../../lib/platform'
import { ChatLink } from '../MessageResponse'

import type { LocalUrl } from './localUrls'

export type OpenLink = (href: string, beside: boolean) => boolean

const CHIP =
  'group/local inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-md border border-zGray-800 bg-zGray-900/60 pl-1.5 pr-0.5 align-[-0.35em] text-[12.5px] leading-none text-main no-underline transition-colors duration-150 hover:border-zGray-700 hover:bg-zGray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none'
const CARD =
  'group/local flex min-h-24 w-full max-w-[520px] items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900/60 px-4 py-3 text-main no-underline transition-colors duration-150 hover:border-zGray-700 hover:bg-zGray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none'

/** A prominent local preview, opened in the existing browser pane with one click. */
export function LocalUrlChip({
  url,
  label,
  onOpen,
  variant = 'inline',
}: {
  url: LocalUrl
  /** The author's link text; without it the chip shows the address. */
  label?: string
  onOpen?: OpenLink
  variant?: 'inline' | 'card'
}) {
  return (
    <ChatLink
      link={url.href}
      onLinkClick={onOpen}
      className={variant === 'card' ? CARD : CHIP}
      title={`Open ${url.href} in a browser tab (${isMac ? '⌘' : 'Ctrl'}-click opens it beside)`}
    >
      {variant === 'card' ? (
        <>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zGray-800/60">
            <AppWindow aria-hidden className="size-5 text-secondary" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 break-words text-[14px] font-medium leading-5">
              {label ?? 'Local preview'}
            </span>
            <span className="truncate font-mono text-[11px] leading-4 text-tertiary">
              {url.label}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-zViolet-accent transition-colors duration-150 group-hover/local:bg-zViolet-accent/10 motion-reduce:transition-none">
            Open
            <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2} />
          </span>
        </>
      ) : (
        <>
          <AppWindow aria-hidden className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
          <span
            className={
              label
                ? 'min-w-0 max-w-[32ch] truncate leading-5'
                : 'min-w-0 max-w-[32ch] truncate font-mono text-[12px] leading-5'
            }
          >
            {label ?? url.label}
          </span>
          <span className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded px-1 text-[11.5px] font-medium text-zViolet-accent transition-colors duration-150 group-hover/local:bg-zViolet-accent/10 motion-reduce:transition-none">
            Open
            <ArrowUpRight aria-hidden className="size-3" strokeWidth={2} />
          </span>
        </>
      )}
    </ChatLink>
  )
}

/** Servers a local tool started this turn that the answer never linked. */
export function LocalUrlStrip({ urls, onOpen }: { urls: LocalUrl[]; onOpen?: OpenLink }) {
  if (urls.length === 0) return null

  return (
    <div className="t-chat-card-in flex flex-col items-start gap-1 text-[12.5px] text-tertiary">
      <span>Local previews</span>
      {urls.map((url) => (
        <LocalUrlChip key={url.href} url={url} onOpen={onOpen} variant="card" />
      ))}
    </div>
  )
}
