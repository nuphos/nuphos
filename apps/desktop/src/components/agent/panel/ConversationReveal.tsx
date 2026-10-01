import { motion, useReducedMotion } from 'framer-motion'

import type { ReactNode } from 'react'

export function ConversationReveal({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      key={sessionId}
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-0 flex-1"
    >
      {children}
    </motion.div>
  )
}
