import { isAppWebUrl } from '../webBaseUrl.ts'

import { clusterPageSegment } from './sections.ts'
import { DEFAULT_GITHUB_NAV, DEFAULT_KEY, DEFAULT_REPO_PROVIDER } from './types.ts'

import type { NavigationSnapshot } from './types.ts'
import type { GithubInstallation, GithubRepository, Scope } from '../../types'

// ---------------------------------------------------------------------------
// Parser: path → NavigationSnapshot.
// ---------------------------------------------------------------------------

/** A NavigationSnapshot with every non-scope field at its default. */
export function emptyNavigation(
  scope: Scope,
  active: string = DEFAULT_KEY[scope.kind],
  extra: Partial<NavigationSnapshot> = {},
): NavigationSnapshot {
  return {
    scope,
    active,
    target: null,
    grafanaInstance: null,
    dashboardTarget: null,
    traceDatasourceTarget: null,
    logDatasourceTarget: null,
    githubNav: DEFAULT_GITHUB_NAV,
    repoProvider: DEFAULT_REPO_PROVIDER,
    agentSessionId: null,
    s3Detail: null,
    ...extra,
  }
}

/** URL-restored GitHub installation stub; the view refines it once loaded. */
export function githubInstallationFromId(
  installationId: string,
  accountLogin = '',
): GithubInstallation {
  return {
    id: installationId,
    installationId: Number(installationId),
    accountLogin,
    accountType: 'Organization',
    accountId: 0,
    targetType: 'selected',
  }
}

/** URL-restored GitHub repository stub; the view refines it once loaded. */
export function githubRepositoryFromPath(owner: string, repo: string): GithubRepository {
  return {
    id: 0,
    name: repo,
    fullName: `${owner}/${repo}`,
    private: false,
    htmlUrl: `https://github.com/${owner}/${repo}`,
    description: null,
    defaultBranch: null,
    archived: false,
    visibility: null,
    pushedAt: null,
  }
}

// Providers whose infra pages need only a scope factory — their section pages
// come from PROVIDER_SECTIONS like everyone else's.
export const SIMPLE_PROVIDER_ROUTES: Record<
  string,
  { scope: (teamId: string, id: string) => Scope }
> = {
  linode: {
    scope: (teamId, id) => ({ kind: 'linode-account', teamId, accountId: id }),
  },
  hetzner: {
    scope: (teamId, id) => ({ kind: 'hetzner-account', teamId, accountId: id }),
  },
  tencent: {
    scope: (teamId, id) => ({ kind: 'tencent-account', teamId, accountId: id }),
  },
  aliyun: {
    scope: (teamId, id) => ({ kind: 'aliyun-account', teamId, accountId: id }),
  },
  volcengine: {
    scope: (teamId, id) => ({ kind: 'volcengine-account', teamId, accountId: id }),
  },
  betterstack: {
    scope: (teamId, id) => ({ kind: 'betterstack-integration', teamId, integrationId: id }),
  },
  'uptime-kuma': {
    scope: (teamId, id) => ({ kind: 'uptime-kuma-instance', teamId, instanceId: id }),
  },
  mongodb: {
    scope: (teamId, id) => ({ kind: 'database-connection', teamId, connectionId: id }),
  },
  tailscale: {
    scope: (teamId, id) => ({ kind: 'tailscale-client', teamId, clientId: id }),
  },
  zeabur: {
    scope: (teamId, id) => ({ kind: 'zeabur-provider', teamId, zeaburId: id }),
  },
}

export function splitAppPath(path: string): { segs: string[]; query: URLSearchParams } | null {
  // Bare paths resolve against the configured web origin; an absolute URL on
  // any other host (docs., api., …) is not an app page.
  const url = isAppWebUrl(path)

  if (!url) return null
  try {
    return {
      segs: url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
      query: url.searchParams,
    }
  } catch {
    // Malformed percent-encoding survives WHATWG URL parsing but not decoding.
    return null
  }
}

/** The active key a k8s page's path segments belong to, or null when they
 *  aren't a known page. Self-inverse against clusterPageSegment so the
 *  vocabulary isn't duplicated. */
export function clusterActiveForPageSegments(segs: string[]): string | null {
  if (segs.length === 0) return null
  const joined = segs.join('/')
  const candidate = segs.length === 1 ? `cluster.${segs[0]}` : `${segs[0]}.${segs[1]}`

  return clusterPageSegment(candidate) === joined ? candidate : null
}
