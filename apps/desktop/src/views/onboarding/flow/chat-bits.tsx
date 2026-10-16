import { motion } from 'framer-motion'

import { EASE_OUT } from './shared'

import type { ReactNode } from 'react'

// User message — right-aligned gray bubble, matching the real agent panel.
export function UserMsg({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="flex flex-col items-end"
    >
      <div className="max-w-[85%] break-words rounded-2xl border border-zGray-800 bg-zGray-800/60 px-3.5 py-2 text-[14.5px] text-main">
        {children}
      </div>
    </motion.div>
  )
}
