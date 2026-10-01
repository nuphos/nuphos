import { Button as BaseButton } from '@base-ui/react/button'
import { ChevronRight, Sparkles } from 'lucide-react'

import type { AgentStarterSuggestion } from '../../../api'

// "Suggested for your setup" — the LLM-generated starter cards shown on the
// page home once the team has bound at least one integration. Picking a card
// seeds its prompt straight into a new conversation.
export function StarterSuggestionsBlock({
  loading,
  suggestions,
  onPick,
}: {
  loading: boolean
  suggestions: AgentStarterSuggestion[]
  onPick: (prompt: string) => void
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 mb-3 px-3 text-[11px] uppercase text-tertiary">
        <Sparkles className="w-3 h-3 text-zViolet-accent" strokeWidth={2} />
        <span>Suggested for your setup</span>
      </div>
      {loading && suggestions.length === 0 ? (
        <div className="space-y-1.5 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-lg bg-zGray-800/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {suggestions.map((s, i) => (
            <BaseButton
              key={i}
              onClick={() => onPick(s.prompt)}
              className="group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-zGray-800/60 outline-none focus-visible:bg-zGray-800/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-400/50"
            >
              <Sparkles
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-zViolet-accent"
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <div className="text-[13px] text-secondary group-hover:text-main">{s.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-tertiary">
                  {s.prompt}
                </div>
              </div>
              <ChevronRight className="ml-auto mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </BaseButton>
          ))}
        </div>
      )}
    </div>
  )
}
