import { Button as BaseButton } from '@base-ui/react/button'
import { WandSparkles, X } from 'lucide-react'

// Connecting lives attached to the composer, not in the middle of the page.
// Every product that does this well treats it the same way — Mistral hangs it
// off the composer's + menu, Cursor off a popover beside it — because a team
// with nothing connected still came here to type something, and a card in the
// centre of the screen makes setup the price of entry.
//
// One button, not a row of logos. A logo grid asks "which of these eight?" of
// someone who does not yet know that the answer changes anything, so picking a
// cloud moves inside the guide, where there is context for the choice.
//
// The line stays on what the user gets. How the access works — that we never
// hold a key, that the role lives in their console — is the guide's second
// screen, reached by someone who just clicked to find out what they are handing
// over. Said here, unprompted, it is a lecture nobody asked for. The X is for
// people who mean "not now".
export function ConnectorStrip({
  onStart,
  onDismiss,
}: {
  onStart: () => void
  onDismiss: () => void
}) {
  return (
    // Tucked 12px under the composer, matching its first-run 12px corner
    // radius so the strip's square top stays hidden behind the curve.
    <div className="relative z-0 -mt-3 flex items-center gap-3 rounded-b-xl bg-field px-4 pb-2 pt-5">
      <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
        Start with billing read-only and see where your cloud spend is going.
      </span>
      <div className="flex flex-shrink-0 items-center gap-1">
        <BaseButton
          onClick={onStart}
          className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-zViolet-accent outline-none transition-colors hover:bg-zViolet-accent/15 focus-visible:bg-zViolet-accent/15"
        >
          <WandSparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
          Walk me through it
        </BaseButton>
        <BaseButton
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary outline-none transition-colors hover:bg-zGray-800/60 hover:text-main"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </BaseButton>
      </div>
    </div>
  )
}
