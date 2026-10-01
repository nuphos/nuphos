import { awsAppPath } from './aws.ts'
import { cloudflareAppPath } from './cloudflare.ts'
import { gcpAppPath } from './gcp.ts'
import { githubAppPath, parseGithubLink } from './github.ts'
import { grafanaAppPath } from './grafana.ts'
import { linearAppPath, parseLinearLink } from './linear.ts'

import type {
  AwsAccount,
  CloudflareAccount,
  GcpProject,
  GithubInstallation,
  GrafanaInstance,
  LinearWorkspace,
} from '../../types'

export type BoundResources = {
  github: readonly GithubInstallation[]
  grafana: readonly GrafanaInstance[]
  aws: readonly AwsAccount[]
  gcp: readonly GcpProject[]
  cloudflare: readonly CloudflareAccount[]
  linear: readonly LinearWorkspace[]
}

/**
 * The in-app path for a provider URL whose resource this team has bound, or
 * null when nothing bound matches — then the link belongs in the browser.
 *
 * Grafana is matched by bound URL rather than hostname (self-hosted instances
 * live anywhere), and the cloud consoles by the account/project the link names,
 * falling back to a sole binding when the URL names none.
 */
export function appPathForExternalLink(
  href: string,
  teamId: string,
  bound: BoundResources,
): string | null {
  let url: URL

  try {
    url = new URL(href.trim())
  } catch {
    return null
  }
  // A self-hosted Grafana may legitimately be bound over plain http; the
  // public providers below are https-only and check that themselves.
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    return null
  }
  const github = parseGithubLink(url)

  if (github) return githubAppPath(teamId, bound.github, github)

  const linear = parseLinearLink(url)

  if (linear) return linearAppPath(teamId, bound.linear, linear)

  return (
    grafanaAppPath(teamId, bound.grafana, url) ??
    awsAppPath(teamId, bound.aws, url) ??
    gcpAppPath(teamId, bound.gcp, url) ??
    cloudflareAppPath(teamId, bound.cloudflare, url)
  )
}

/** Whether a link is a GitHub page the app can host once the repo is bound. */
export function isBindableGithubLink(href: string): boolean {
  try {
    return parseGithubLink(new URL(href.trim())) !== null
  } catch {
    return false
  }
}

/** Whether a link is a Linear issue page the app can host once the workspace is bound. */
export function isBindableLinearLink(href: string): boolean {
  try {
    return parseLinearLink(new URL(href.trim())) !== null
  } catch {
    return false
  }
}
