import { motion } from 'framer-motion'
import { useCallback, useState } from 'react'

import { UserMsg } from './chat-bits'
import { deriveFirstName, EASE_OUT } from './shared'
import { StreamText } from './stream'

import type { ChatStep } from './shared'
import type { UserInfo } from '../../../types'

// The onboarding conversation: the agent asks for a workspace, the user names
// one, and the transcript shows it being set up.
export function ChatTranscript({
  user,
  reduce,
  chatStep,
  workspaceName,
  hasJoinOptions,
  workspaceMode,
}: {
  user: UserInfo
  reduce: boolean
  chatStep: ChatStep
  workspaceName: string
  hasJoinOptions: boolean
  workspaceMode: 'pick' | 'create'
}) {
  const firstName = deriveFirstName(user)
  // The bridge line below waits for the greeting to finish typing rather than
  // starting its own clock at mount — otherwise the two type over each other.
  const [greetingDone, setGreetingDone] = useState(false)
  const markGreetingDone = useCallback(() => setGreetingDone(true), [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="space-y-4"
    >
      <StreamText
        reduce={reduce}
        startDelay={300}
        onDone={markGreetingDone}
        segments={
          hasJoinOptions
            ? [
                `Hi ${firstName || 'there'}! You have `,
                { text: 'teams', className: 'text-zViolet-300' },
                ' waiting for you — join the ones you want, or create your own workspace.',
              ]
            : [
                `Hi ${firstName || 'there'}! Let's set up your first `,
                { text: 'workspace', className: 'text-zViolet-300' },
                '.',
              ]
        }
      />

      {/* Bridge line when the user leaves the pick screen for the create
          composer: the greeting above pitched the join list, so the agent
          acknowledges the switch instead of rewriting history. */}
      {hasJoinOptions && workspaceMode === 'create' && greetingDone && (
        <StreamText
          reduce={reduce}
          startDelay={200}
          segments={['Sure — give your new workspace a name below.']}
        />
      )}

      {chatStep === 'creating' && (
        <>
          <UserMsg>{workspaceName}</UserMsg>
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="codex-shimmer-text t-text-swap">Setting up your workspace…</span>
          </div>
        </>
      )}
    </motion.div>
  )
}
