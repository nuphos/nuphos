import { motion } from 'framer-motion'

import { EASE_OUT } from './progress'

export function Reveal({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

// One row of the conversation checklist. The markers are plain and identical
// throughout — where the user is up to is said in each row's own words (and
// tracked by the journey strip above), so numbering that also changed colour
// was three indicators for one fact. Top-aligned so a wrapping line keeps the
// marker on its first line.
export function StepRow({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 text-[12.5px] text-secondary">
      <span className="mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-zGray-800 text-[10px] font-medium text-tertiary">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}
