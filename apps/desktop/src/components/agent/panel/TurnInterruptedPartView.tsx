import { CircleAlert } from 'lucide-react'

import { normalizeAgentError } from './stall'

import type { TurnInterruptedPart } from './parts'

const HEADLINE: Record<TurnInterruptedPart['reason'], string> = {
  cancelled: 'Turn stopped.',
  timeout: 'Turn timed out.',
  error: 'Turn failed.',
}

export function TurnInterruptedPartView({ part }: { part: TurnInterruptedPart }) {
  const detail = normalizeAgentError(part.message)

  return (
    <div className="flex items-start gap-1.5 text-[12.5px] text-tertiary">
      <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-red-400" />
      <span>
        <span className="font-medium text-secondary">{HEADLINE[part.reason]}</span>
        {detail && <> {detail}</>}
      </span>
    </div>
  )
}
