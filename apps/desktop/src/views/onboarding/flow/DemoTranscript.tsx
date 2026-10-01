import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MessageResponse } from '../../../components/agent/MessageResponse'

import { EASE_OUT } from './shared'

import type { DemoScenario } from './shared'

// The dynamic headline noun in "Ask your ___." — each character pops in with
// the shared Number pop-in motion (t-digit). `key={text}` remounts the group on
// every change so the CSS animation replays; per-letter animationDelay staggers
// the cascade. prefers-reduced-motion is handled by the .t-digit CSS itself.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function PopInWord({ text }: { text: string }) {
  return (
    <span key={text} className="t-digit-group is-animating" aria-label={text}>
      {Array.from(GRAPHEME_SEGMENTER.segment(text), (s) => s.segment).map((ch, i) => (
        <span
          key={i}
          className="t-digit"
          style={{ animationDelay: `${String(i * 38)}ms` }}
          aria-hidden="true"
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  )
}

const swallowDemoLink = () => true

// The scripted demo conversation (transcript only). The composer is owned by
// AgentPanelStage so it can persist across the morph, so this just streams the
// user request, the agent reply, the tool rows, and the closing line.
export function DemoTranscript({
  scenario,
  reduce,
  onDone,
}: {
  scenario: DemoScenario
  reduce: boolean
  onDone: () => void
}) {
  const [sent, setSent] = useState(reduce)
  const [thinking, setThinking] = useState(false)
  const [replyShown, setReplyShown] = useState(reduce)
  const [toolsShown, setToolsShown] = useState(reduce ? scenario.steps.length : 0)
  const [resultShown, setResultShown] = useState(reduce)

  useEffect(() => {
    const timers: number[] = []
    let cumulative = 0
    const at = (delay: number, fn: () => void) => {
      cumulative += delay
      timers.push(window.setTimeout(fn, cumulative))
    }

    if (reduce) {
      at(3800, onDone)
    } else {
      at(500, () => {
        setSent(true)
        setThinking(true)
      })
      at(700, () => {
        setThinking(false)
        setReplyShown(true)
      })
      scenario.steps.forEach((_, i) => at(720, () => setToolsShown(i + 1)))
      at(900, () => setResultShown(true))
      at(2600, onDone)
    }

    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [scenario, reduce, onDone])

  // Opacity-only enter/exit: a lingering `transform` here would promote the
  // transcript to a compositing layer and kill the panel's vibrancy frost.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="space-y-4"
    >
      {sent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="flex flex-col items-end gap-1.5"
        >
          <div className="max-w-[85%] break-words rounded-2xl border border-zGray-800 bg-zGray-800/60 px-3.5 py-2">
            <MessageResponse onLinkClick={swallowDemoLink}>{scenario.prompt}</MessageResponse>
          </div>
        </motion.div>
      )}

      {thinking && (
        <div className="flex items-center gap-2 text-[13.5px]">
          <span className="codex-shimmer-text t-text-swap">Thinking</span>
        </div>
      )}

      {replyShown && (
        <div className="space-y-2">
          <MessageResponse streaming={!reduce && !resultShown} onLinkClick={swallowDemoLink}>
            {scenario.reply}
          </MessageResponse>

          {scenario.steps.map((step, i) => {
            if (i >= toolsShown) return null
            const running = i === toolsShown - 1 && !resultShown

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="text-[12.5px]"
              >
                <div className="group inline-flex max-w-full items-center gap-1.5 text-tertiary">
                  {running ? (
                    <span className="codex-shimmer-text t-text-swap">{step}</span>
                  ) : (
                    <span className="truncate text-left">{step}</span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-0" strokeWidth={1.8} />
                </div>
              </motion.div>
            )
          })}

          {resultShown && (
            <MessageResponse onLinkClick={swallowDemoLink}>{scenario.result}</MessageResponse>
          )}
        </div>
      )}
    </motion.div>
  )
}
