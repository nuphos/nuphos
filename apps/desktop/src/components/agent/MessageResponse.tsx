import { cjk as cjkPlugin } from '@streamdown/cjk'
import { createCodePlugin } from '@streamdown/code'
import clsx from 'clsx'
import { Check, Copy } from 'lucide-react'
import { isValidElement, memo, useMemo, useState } from 'react'

import type { ComponentProps, MouseEvent, ReactNode } from 'react'

import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

import { isSynthesizedAutolink } from '../../lib/markdownAutolink'

type StreamdownComponents = ComponentProps<typeof Streamdown>['components']
type StreamdownAnimated = ComponentProps<typeof Streamdown>['animated']

const STREAMING_TEXT_ANIMATION: StreamdownAnimated = {
  animation: 'atlas-stream-in',
  duration: 240,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  sep: 'word',
  stagger: 0,
}

function extractText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode } | undefined

    return extractText(props?.children)
  }

  return ''
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main"
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? (
        <Check className="h-3 w-3" strokeWidth={2.4} />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={1.8} />
      )}
    </button>
  )
}

function CodeBlock({ children }: { children: ReactNode }) {
  // Streamdown wraps fenced blocks as <pre><code className="language-xxx">...</code></pre>.
  // The <code> child carries the language tag and (after the highlighter runs) the shiki tokens.
  const codeNode = isValidElement(children) ? children : null
  const codeProps = codeNode?.props as { className?: string; children?: ReactNode } | undefined
  const lang = codeProps?.className?.match(/language-([\w+-]+)/)?.[1] ?? ''
  const rawText = extractText(codeProps?.children)

  return (
    <div
      data-codeblock
      className="my-2 overflow-hidden rounded-md bg-zGray-900/50 ring-1 ring-zGray-800/50"
    >
      <div className="flex h-7 items-center justify-between border-b border-zGray-800/40 px-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-tertiary">
          {lang || 'code'}
        </span>
        <CopyButton text={rawText} />
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[13.5px] leading-[1.55] text-main [overflow-wrap:anywhere]">
        {children}
      </pre>
    </div>
  )
}

function createComponents(
  onLinkClick?: (href: string) => boolean,
  renderLink?: (href: string, children: ReactNode) => ReactNode | null,
): StreamdownComponents {
  return {
    p: ({ children }) => <p className="my-3 leading-[1.75] first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="my-3 list-outside list-disc space-y-1.5 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-outside list-decimal space-y-1.5 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-[1.75]">{children}</li>,
    h1: ({ children }) => (
      <h1 className="mt-3 mb-1.5 text-[16px] font-semibold text-main">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-3 mb-1.5 text-[15.5px] font-semibold text-main">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-2.5 mb-1 text-[15px] font-semibold text-main">{children}</h3>
    ),
    a: ({ children, href }) => {
      const link = href as string | undefined

      if (link && renderLink) {
        const custom = renderLink(link, children)

        if (custom != null) return <>{custom}</>
      }
      // Mention links above are matched on an explicit `https://nuphos.ai/`, so
      // they are never mistaken for a GFM-synthesized one.
      if (link && isSynthesizedAutolink(link, extractText(children))) {
        return <>{children}</>
      }
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!link || !onLinkClick) return
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        if (onLinkClick(link)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      return (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          onClick={handleClick}
          className="text-zViolet-accent hover:underline"
        >
          {children}
        </a>
      )
    },
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-zGray-700 pl-3 text-tertiary">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-zGray-800" />,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-md border border-zGray-800 text-[13.5px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-zGray-900">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
      <th className="border-b border-zGray-800 px-2.5 py-1.5 text-left font-medium text-main">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-zGray-800 px-2.5 py-1.5 text-main last:[tr:last-child_&]:border-b-0">
        {children}
      </td>
    ),
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  }
}

const codePlugin = createCodePlugin({ themes: ['night-owl', 'night-owl'] })

type Props = {
  children: string
  className?: string
  streaming?: boolean
  teamId?: string
  currentUrl?: string
  onLinkClick?: (href: string) => boolean
  /** Render a link as a custom node instead of the default anchor (return null to fall through). */
  renderLink?: (href: string, children: ReactNode) => ReactNode | null
}

export const MessageResponse = memo(
  ({ children, className, streaming = false, onLinkClick, renderLink }: Props) => {
    const components = useMemo(
      () => createComponents(onLinkClick, renderLink),
      [onLinkClick, renderLink],
    )

    return (
      <div
        className={clsx(
          'min-w-0 text-[14px] text-main [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          // Streamdown wraps fenced code in its own card (language label + sticky action bar +
          // an inner <pre> with its own border/padding). We replace the <pre> via the `pre`
          // component override above, then make the outer card disappear with `display:contents`
          // and hide everything except our marked CodeBlock.
          '[&_div.bg-sidebar]:contents',
          '[&_div.bg-sidebar>*:not([data-codeblock])]:hidden',
          // Inline code: subtle pill (the `:not(pre)>code` selector dodges code inside our CodeBlock).
          '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-zGray-800/70 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13.5px] [&_:not(pre)>code]:text-main',
          streaming && 'agent-streaming-response',
          className,
        )}
      >
        <Streamdown
          mode={streaming ? 'streaming' : 'static'}
          isAnimating={streaming}
          animated={streaming ? STREAMING_TEXT_ANIMATION : false}
          controls={false}
          // cjk: ends an autolink at CJK punctuation. Without it `https://…/ec2，然後`
          // swallows the rest of the sentence into the href.
          plugins={{ code: codePlugin, cjk: cjkPlugin }}
          components={components}
        >
          {children}
        </Streamdown>
      </div>
    )
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.className === next.className &&
    prev.streaming === next.streaming &&
    prev.onLinkClick === next.onLinkClick &&
    prev.renderLink === next.renderLink,
)

MessageResponse.displayName = 'MessageResponse'
