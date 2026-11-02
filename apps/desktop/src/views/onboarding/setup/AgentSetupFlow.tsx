import { useState } from 'react'

import { LocalAgentsStep } from './LocalAgentsStep'
import { SetupComplete } from './SetupComplete'

/**
 * Full-window setup after creating a workspace: the runtimes on this computer, then
 * "You're all set". More runtimes are added later from Settings › Runtimes or the
 * composer's runtime picker.
 */
export function AgentSetupFlow({ onFinish }: { onFinish: () => void }) {
  const [done, setDone] = useState(false)

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto sidebar-surface px-6 pb-10 pt-14 text-main">
      {/* Same surface as the create-workspace step before it, so the window does not change colour. */}
      {/* Only the top strip drags the window, so portaled dialogs keep their clicks. */}
      <div className="titlebar-drag absolute inset-x-0 top-0 h-11" aria-hidden="true" />
      {done ? (
        <SetupComplete onFinish={onFinish} />
      ) : (
        <LocalAgentsStep onContinue={() => setDone(true)} />
      )}
    </div>
  )
}
