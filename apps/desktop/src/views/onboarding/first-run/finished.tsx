import { firstRunVocabulary } from '../../../lib/firstRunConnect'

import { ConnectedInfo } from './previews'

import type { FirstRunProvider } from '../../../lib/firstRunConnect'

export function FinishedStage({ provider }: { provider: FirstRunProvider }) {
  const v = firstRunVocabulary(provider)

  return (
    <div>
      <ConnectedInfo provider={provider} />
      <p className="pt-3 text-[12.5px] leading-relaxed text-secondary">
        Keep exploring in chat. If a task needs more access, update your {v.noun}'s permissions in
        the {v.label} console, then ask the agent to try again.
      </p>
    </div>
  )
}
