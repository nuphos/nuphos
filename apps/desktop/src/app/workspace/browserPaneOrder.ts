// Browser panes are rendered in the order their tabs were created, and that
// order is read off the tabs themselves rather than remembered.
//
// Moving a node inside the DOM is a removal followed by an insertion, which
// runs the custom element's disconnected/connected callbacks — and for an
// Electron `<webview>` that destroys the guest and reloads the page, the exact
// thing keeping the pane mounted is meant to avoid. So a pane that is already
// rendered may never change position.
//
// `createdSeq` gives that for free: it is fixed for a tab's whole life and a
// tab created later always sorts after one created earlier, so a new pane can
// only ever land at the end and the rest keep their places. Removing a pane
// does not move its siblings, and inserting one before them does not either.
// Deriving the order this way (rather than accumulating it across renders)
// also means a render React discards cannot claim a slot.

type PaneOrderKey = { id: string; createdSeq: number }

/** Browser panes in creation order; the id only breaks a tie that cannot
 *  normally happen, so the result is total and stable. */
export function orderBrowserPanes<T extends PaneOrderKey>(tabs: readonly T[]): T[] {
  return [...tabs].sort((a, b) => a.createdSeq - b.createdSeq || a.id.localeCompare(b.id))
}
