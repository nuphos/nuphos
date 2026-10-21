import { useCallback } from 'react'

import { GithubRefChip, GithubRefLink } from './GithubRefChip'
import { githubRef, isBareGithubLink } from './githubRefs'
import { flattenLinkText } from './messageInlineLinks'
import { useLocalUrlLinks } from './useLocalUrlLinks'

import type { GithubRef } from './githubRefs'
import type { OpenLink } from './LocalUrlChip'
import type { LinkRenderOptions } from '../localPreviewLink'
import type { ReactNode } from 'react'

function renderGithubLink(
  ref: GithubRef,
  children: ReactNode,
  teamId: string | undefined,
  onOpen: OpenLink | undefined,
): ReactNode {
  if (isBareGithubLink(ref, flattenLinkText(children))) {
    return <GithubRefChip githubRef={ref} teamId={teamId} onOpen={onOpen} />
  }

  return (
    <GithubRefLink githubRef={ref} teamId={teamId} onOpen={onOpen}>
      {children}
    </GithubRefLink>
  )
}

/** Links in agent text that render as chips: pull requests, issues and local servers. */
export function useAgentLinks(teamId: string | undefined, onOpen?: OpenLink) {
  const renderLocal = useLocalUrlLinks(onOpen)

  return useCallback(
    (href: string, children: ReactNode, options?: LinkRenderOptions): ReactNode => {
      const ref = githubRef(href)

      return ref
        ? renderGithubLink(ref, children, teamId, onOpen)
        : renderLocal(href, children, options)
    },
    [onOpen, renderLocal, teamId],
  )
}
