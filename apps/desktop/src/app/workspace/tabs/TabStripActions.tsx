import { WandSparkles } from 'lucide-react'

type TabStripActionsProps = {
  firstRunConnectAvailable?: boolean
  onStartFirstRunConnect?: () => void
}

/**
 * The trailing slot of the tab strip, which only first run has anything to put
 * in. The agent chat toggle used to live here too, but the trailing edge of
 * this row is not a place a control can stay: the tab strip grows into it, and
 * on Windows and Linux the native caption buttons own the corner outright
 * (see `.titlebar-caption-pad`). It sits in the toolbar's trailing group now.
 */
export function TabStripActions({
  firstRunConnectAvailable,
  onStartFirstRunConnect,
}: TabStripActionsProps) {
  if (!firstRunConnectAvailable || !onStartFirstRunConnect) return null

  return (
    // Same affordance as the composer's tray. On first run the dock has a more
    // important job than opening a chat, so name that job directly. It stays in
    // the titlebar because it is a walkthrough invitation, not a utility — a
    // labelled CTA would be buried among the toolbar's icon buttons.
    <button
      type="button"
      onClick={onStartFirstRunConnect}
      className="titlebar-no-drag flex h-6 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-zViolet-accent outline-none transition-colors hover:bg-zViolet-accent/15 focus-visible:bg-zViolet-accent/15"
    >
      <WandSparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
      Walk me through it
    </button>
  )
}
