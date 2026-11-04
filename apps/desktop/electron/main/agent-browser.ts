// Browser tabs an agent opens live in their own session: none of the user's
// extensions, cookies or site data. The renderer creates every Dock tab in
// `persist:browser`; the main process moves an agent's tab when it attaches.

export const AGENT_BROWSER_PARTITION = 'persist:browser-agent'

/** Addresses an agent's `open` is waiting for, each claimed by one attaching tab. */
const expected: string[] = []

const href = (url: string) => (URL.canParse(url) ? new URL(url).href : url)

/** Marks the next tab that attaches at `url` as the agent's. Returns a function that drops the mark. */
export function expectAgentTab(url: string): () => void {
  const entry = href(url)

  expected.push(entry)

  return () => {
    const index = expected.indexOf(entry)

    if (index !== -1) expected.splice(index, 1)
  }
}

/** Whether a tab attaching at `src` is one an agent asked for; claims the mark. */
export function claimAgentTab(src: string): boolean {
  const index = expected.indexOf(href(src))

  if (index === -1) return false
  expected.splice(index, 1)

  return true
}
