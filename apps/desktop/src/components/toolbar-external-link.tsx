import { openOnGithub } from '../views/github-repo/openOnGithub'
import { openOnLinear } from '../views/openOnLinear'

import { GithubMark } from './GithubMark'
import { LinearMark } from './LinearMark'

import type { ExternalPageLink } from '../lib/externalPageLink'

const PROVIDERS = {
  github: { label: 'Open in GitHub', Icon: GithubMark, open: openOnGithub },
  linear: { label: 'Open in Linear', Icon: LinearMark, open: openOnLinear },
} satisfies Record<ExternalPageLink['provider'], unknown>

export function ExternalPageLinkButton({ link }: { link: ExternalPageLink }) {
  const { label, Icon, open } = PROVIDERS[link.provider]

  return (
    <button
      type="button"
      onClick={() => open(link.url)}
      className="w-7 h-7 rounded-md hover:bg-zGray-800/60 text-secondary hover:text-main flex items-center justify-center"
      title={label}
      aria-label={label}
    >
      <Icon size={14} />
    </button>
  )
}
