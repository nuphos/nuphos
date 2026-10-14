import { Globe } from 'lucide-react'

import { browserAddressUrl } from '../../lib/browserUrl'

import type { NewTabOption } from '../../lib/launcherMatch'

/** The omnibox row: typed text that reads as an address opens in a Browser tab. */
export function browserAddressOption(
  query: string,
  teamId: string,
  onOpenPath: (href: string, label: string, newTab: boolean) => void,
): NewTabOption | null {
  const url = browserAddressUrl(query)

  if (!url) return null
  const href = `/teams/${encodeURIComponent(teamId)}/browser?${new URLSearchParams({ url })}`

  return {
    id: `browser:${url}`,
    label: `Open ${url} in Browser`,
    icon: (
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-secondary">
        <Globe className="h-3.5 w-3.5" strokeWidth={1.7} />
      </span>
    ),
    open: (newTab) => onOpenPath(href, url, newTab),
  }
}
