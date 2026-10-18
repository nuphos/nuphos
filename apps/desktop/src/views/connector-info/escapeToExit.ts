/** What one connector detail view knows about an Escape key event. */
export type EscapeContext = {
  key: string
  /** Another handler, such as a second detail pane, already acted on this event. */
  handled: boolean
  /** A dialog, menu or popover is open and owns Escape. */
  overlayOpen: boolean
  /** Focus is in a text field, where Escape belongs to the field. */
  inField: boolean
  /** Focus is inside this detail view. */
  inView: boolean
  /** Focus is inside a different connector detail view, such as one in another pane. */
  inOtherView: boolean
  /** This view's workspace pane is the active one. */
  paneActive: boolean
}

/**
 * Whether Escape should leave this detail view. The view that owns focus acts; otherwise only the
 * one in the active pane does, so one key press never exits two panes.
 */
export function escapeLeavesView(context: EscapeContext): boolean {
  if (context.key !== 'Escape' || context.handled) return false
  if (context.overlayOpen || context.inField) return false

  return context.inView || (context.paneActive && !context.inOtherView)
}
