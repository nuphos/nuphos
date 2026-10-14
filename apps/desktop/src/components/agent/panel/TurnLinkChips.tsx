import { GithubRefStrip } from './GithubRefChip'
import { turnGithubRefs } from './githubRefs'
import { LocalUrlStrip } from './LocalUrlChip'
import { turnLocalUrls } from './localUrls'

import type { OpenLink } from './LocalUrlChip'
import type { Part } from './parts'

/** Under a finished answer: what the turn's tools produced that the answer never linked. */
export function TurnLinkChips({
  parts,
  teamId,
  onOpen,
}: {
  parts: readonly Part[]
  teamId?: string
  onOpen?: OpenLink
}) {
  return (
    <>
      <GithubRefStrip refs={turnGithubRefs(parts)} teamId={teamId} onOpen={onOpen} />
      <LocalUrlStrip urls={turnLocalUrls(parts)} onOpen={onOpen} />
    </>
  )
}
