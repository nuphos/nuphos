/**
 * A page opened from the New Tab field takes the caret, as Chrome hands it to
 * the page on an address commit: the field that held it has just unmounted, and
 * without this the page's own autofocus (Google's search box) never receives
 * keys and Tab restarts from the toolbar. A page opened while the caret is
 * elsewhere, such as from a link in the composer, leaves it there.
 */
export function focusOpenedPage(
  page: { focus(): void },
  doc: Pick<Document, 'activeElement' | 'body'>,
) {
  if (!doc.activeElement || doc.activeElement === doc.body) page.focus()
}
