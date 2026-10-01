import { motion, useReducedMotion } from 'framer-motion'
import { ChartLine, ScrollText, Sparkles } from 'lucide-react'

import { CloudLogo } from '../../../components/CloudLogo'
import { firstRunVocabulary } from '../../../lib/firstRunConnect'

import { EASE_OUT, WIRING } from './progress'

import type { FirstRunProvider } from '../../../lib/firstRunConnect'

// The wiring the user just built, as an architecture diagram: Nuphos on the
// outside, their cloud account as the boundary box, and inside it the identity
// they created with its single grant, reading nothing but cost data. Nothing
// that doesn't exist yet is drawn — the second role stays out of sight until
// a question actually hits the wall and the agent brings it up itself. Same
// card language as the intro's spend chart.
export function IntegrationDiagram({ provider }: { provider: FirstRunProvider }) {
  const v = firstRunVocabulary(provider)
  const w = WIRING[provider]
  const reduce = useReducedMotion()

  return (
    <div className="rounded-md border border-zGray-800 bg-zGray-850 p-3">
      <div className="text-[10.5px] uppercase tracking-wider text-tertiary">
        How the connection works
      </div>

      <FlowNode delay={0.1} reduce={reduce}>
        <div className="flex items-center gap-2 rounded-md border border-zGray-700/80 bg-zGray-800 px-2.5 py-2">
          <Sparkles className="h-4 w-4 flex-shrink-0 text-zViolet-accent" strokeWidth={1.6} />
          <span className="text-[11.5px] font-medium text-main">Nuphos</span>
          <span className="text-[10.5px] text-tertiary">AI agent</span>
        </div>
      </FlowNode>

      <FlowEdge delay={0.3} reduce={reduce} label={w.via} height={26} />

      {/* mt-0: the edge above must land on this border, not float over a
          margin — a connector that doesn't touch what it connects reads as
          two diagrams. */}
      <FlowNode delay={0.5} reduce={reduce} className="mt-0">
        <div className="rounded-md border border-zGray-700/80 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-tertiary">
            <CloudLogo provider={provider} size={13} />
            {w.home}
          </div>

          <div className="mt-2">
            <FlowNode delay={0.6} reduce={reduce} className="mt-0">
              <div className="rounded-md border border-zGray-700/80 bg-zGray-800 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 flex-shrink-0 text-secondary" strokeWidth={1.6} />
                  <span className="font-mono text-[11px] text-main">{w.identity}</span>
                </div>
                <div className="mt-1.5 inline-block max-w-full truncate rounded bg-zViolet-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-zViolet-accent">
                  {v.scopeGrant}
                </div>
              </div>
            </FlowNode>

            <FlowEdge delay={0.75} reduce={reduce} label="reads" height={18} />

            <FlowNode delay={0.85} reduce={reduce} className="mt-0">
              <div className="flex items-center gap-2 rounded-md border border-zGray-700/80 bg-zGray-800 px-2.5 py-2">
                <ChartLine className="h-4 w-4 flex-shrink-0 text-secondary" strokeWidth={1.6} />
                <span className="text-[11px] text-main">Billing &amp; cost data</span>
              </div>
            </FlowNode>
          </div>
        </div>
      </FlowNode>
    </div>
  )
}

function FlowNode({
  delay,
  reduce,
  className,
  children,
}: {
  delay: number
  reduce: boolean | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      // className REPLACES the default margin rather than joining it: passing
      // mt-0 alongside mt-2 leaves both on the element, and stylesheet order
      // (not class order) decides — mt-2 wins and the override silently loses.
      className={className ?? 'mt-2'}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

// A vertical dashed edge whose dashes march downward — the direction the
// request flows — with its label beside the line.
function FlowEdge({
  delay,
  reduce,
  label,
  height = 22,
}: {
  delay: number
  reduce: boolean | null
  label: string
  height?: number
}) {
  return (
    <motion.div
      className="flex items-center gap-2 pl-[17px]"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.35, ease: 'easeOut' }}
    >
      <svg width="2" height={height} className="flex-shrink-0 text-zGray-700" aria-hidden="true">
        <motion.line
          x1="1"
          y1="0"
          x2="1"
          y2={height}
          stroke="currentColor"
          strokeWidth="1.5"
          // Tight 3/3 dashes: with the marching animation the line's ends sit
          // at a random phase of the pattern, so the gap length is exactly how
          // far a dash can visibly detach from the box it points at.
          strokeDasharray="3 3"
          strokeLinecap="round"
          animate={reduce ? undefined : { strokeDashoffset: [0, -12] }}
          transition={reduce ? undefined : { duration: 1.2, ease: 'linear', repeat: Infinity }}
        />
      </svg>
      <span className="text-[10px] leading-tight text-tertiary">{label}</span>
    </motion.div>
  )
}
