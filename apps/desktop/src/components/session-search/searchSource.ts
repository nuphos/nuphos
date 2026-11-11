/** How ⌘K was opened, for the `search_opened` event: the titlebar button says so; anything else is the shortcut. */
export type SearchSource = 'button' | 'shortcut'

let next: SearchSource = 'shortcut'

export function noteSearchSource(source: SearchSource) {
  next = source
}

export function takeSearchSource(): SearchSource {
  const source = next

  next = 'shortcut'

  return source
}
