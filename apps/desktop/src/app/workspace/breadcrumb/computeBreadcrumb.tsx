import { Cloud, Database, Folder, FolderGit2 } from 'lucide-react'

import { activeNavItemsFor, k8sResourceIcon } from '../../../app/navItems'
import { Avatar } from '../../../components/Avatar'
import { CloudLogo } from '../../../components/CloudLogo'
import { GithubMark } from '../../../components/GithubMark'
import { isIntegrationNavigation } from '../../../lib/connectorScopeCrumb'

import { pushClusterCrumbs } from './clusterCrumbs'
import { pushClusterPickerCrumbs } from './clusterPickerCrumbs'
import { pushConnectorCrumbs } from './connectorCrumbs'
import { pushLinearCrumbs } from './linearCrumbs'
import { pushNavPickerCrumbs } from './navPickerCrumbs'
import { pushZoneAndSshCrumbs } from './sshCrumbs'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { BreadcrumbSegment } from '../../../components/Toolbar'
import type { Scope } from '../../../types'

export function computeBreadcrumb(
  scope: Scope | null,
  rest: Omit<BreadcrumbContext, 'scope'>,
): BreadcrumbSegment[] {
  if (!scope) return []
  const ctx: BreadcrumbContext = { ...rest, scope }
  const {
    active,
    target,
    s3Detail,
    updateActiveTab,
    teams,
    enterScope,
    switchTeam,
    refreshTeamsSilently,
    githubNav,
    repoProvider,
  } = ctx
  const out: BreadcrumbSegment[] = []

  const currentTeam = teams.find((t) => t.id === scope.teamId)

  out.push({
    label: currentTeam?.name ?? 'Team',
    isResource: true,
    icon: (
      <Avatar
        src={currentTeam?.avatarUrl}
        name={currentTeam?.name ?? '?'}
        size={20}
        className="rounded-[5px] !shadow-none"
      />
    ),
    options: teams.map((t) => ({
      key: t.id,
      label: t.name,
      icon: (
        <Avatar src={t.avatarUrl} name={t.name} size={20} className="rounded-[5px] !shadow-none" />
      ),
      selected: t.id === scope.teamId,
      onPick: () => switchTeam(t.id),
    })),
    onExpand: refreshTeamsSilently,
  })

  // Architecture and Connectors used to push their own crumb here, which is
  // why they were the two Overview pages without a page picker. They now go
  // through the shared picker below like every other Overview page; only
  // their drill-down leaf crumbs stay special-cased there.
  // Provider scopes reached from the Connectors page (AWS roles, GCP service
  // accounts, …) get the same root crumb; the team-scope variant above
  // already covers the list and info pages.
  const isOnpremConnectorResource =
    scope.kind === 'cluster' && scope.parentKind === 'onprem-cluster'

  if (
    scope.kind !== 'team' &&
    (isIntegrationNavigation(scope, active) || isOnpremConnectorResource)
  ) {
    out.push({
      label: 'Connectors',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      onClick: () => enterScope({ kind: 'team', teamId: scope.teamId }, 'team.integrations'),
      // The same sibling picker the Connectors page carries when you are on
      // it. Drilling into a connector changes the scope, so the shared nav
      // picker stops recognising this crumb and it is rebuilt here — without
      // the list it would be the one first-level crumb that cannot reach its
      // siblings. The label still goes back to Connectors; the chevron is the
      // other half of the split.
      options: activeNavItemsFor({ kind: 'team', teamId: scope.teamId }, 'team.integrations').map(
        (item) => ({
          key: item.key,
          label: item.label,
          group: item.group,
          icon: item.icon,
          selected: item.key === 'team.integrations',
          onPick: () => enterScope({ kind: 'team', teamId: scope.teamId }, item.key),
        }),
      ),
    })
  }
  // Chats belongs to the agent and is reached from its home, so the trail
  if (scope.kind === 'team' && active === 'team.repository') {
    out.push(
      repoProvider === 'gitlab'
        ? { label: 'GitLab', icon: <CloudLogo provider="gitlab" size={14} /> }
        : {
            label: 'GitHub',
            icon: <GithubMark size={14} className="text-tertiary" />,
            onClick: () =>
              updateActiveTab((tab) => ({ ...tab, githubNav: { view: 'installations' } })),
          },
    )
  }

  if (scope.kind === 'team' && active === 'team.repository' && repoProvider === 'github') {
    if (githubNav.view === 'repos') {
      out.push({
        label: githubNav.installation.accountLogin,
        isResource: true,
        icon: <GithubMark size={14} className="text-tertiary" />,
        onClick: () =>
          updateActiveTab((tab) => ({
            ...tab,
            githubNav: { view: 'installations' },
          })),
      })
    }

    if (githubNav.view === 'repo' || githubNav.view === 'pull') {
      out.push(
        {
          label: githubNav.installation.accountLogin,
          isResource: true,
          icon: <GithubMark size={14} className="text-tertiary" />,
          onClick: () =>
            updateActiveTab((tab) => ({
              ...tab,
              githubNav: {
                view: 'repos',
                installation: githubNav.installation,
              },
            })),
        },
        {
          label: githubNav.repo.name,
          isResource: true,
          icon: <FolderGit2 className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
          onClick:
            githubNav.view === 'pull'
              ? () =>
                  updateActiveTab((tab) => ({
                    ...tab,
                    githubNav: {
                      view: 'repo',
                      installation: githubNav.installation,
                      repo: githubNav.repo,
                      tab: 'prs',
                      prState: githubNav.prState,
                    },
                  }))
              : undefined,
        },
        {
          label: githubNav.view === 'pull' ? 'PRs' : githubNav.tab === 'prs' ? 'PRs' : 'Workflows',
          onClick:
            githubNav.view === 'pull'
              ? () =>
                  updateActiveTab((tab) => ({
                    ...tab,
                    githubNav: {
                      view: 'repo',
                      installation: githubNav.installation,
                      repo: githubNav.repo,
                      tab: 'prs',
                      prState: githubNav.prState,
                    },
                  }))
              : undefined,
          options:
            githubNav.view === 'repo'
              ? [
                  {
                    key: 'prs',
                    label: 'PRs',
                    selected: githubNav.tab === 'prs',
                    onPick: () =>
                      updateActiveTab((tab) => {
                        if (tab.githubNav.view !== 'repo') return tab

                        return { ...tab, githubNav: { ...tab.githubNav, tab: 'prs' } }
                      }),
                  },
                  {
                    key: 'actions',
                    label: 'Workflows',
                    selected: githubNav.tab === 'actions',
                    onPick: () =>
                      updateActiveTab((tab) => {
                        if (tab.githubNav.view !== 'repo') return tab

                        return { ...tab, githubNav: { ...tab.githubNav, tab: 'actions' } }
                      }),
                  },
                ]
              : undefined,
        },
      )
      if (githubNav.view === 'pull') {
        out.push({
          label: githubNav.prTitle || `#${String(githubNav.prNumber)}`,
          isResource: true,
        })
      }
    }
  }

  pushLinearCrumbs(ctx, out)
  pushConnectorCrumbs(ctx, out)
  if (pushZoneAndSshCrumbs(ctx, out)) return out
  pushClusterCrumbs(ctx, out)
  if (pushClusterPickerCrumbs(ctx, out)) return out
  pushNavPickerCrumbs(ctx, out)

  if (scope.kind === 'cluster' && target) {
    out.push({
      label: target.name,
      isResource: true,
      icon: k8sResourceIcon(target.kind),
    })
  }

  if (scope.kind === 'aws-account' && active === 'aws.s3' && s3Detail) {
    const setS3 = (prefix: string | null) =>
      updateActiveTab((tab) => ({
        ...tab,
        s3Detail:
          prefix === null ? null : { bucket: s3Detail.bucket, region: s3Detail.region, prefix },
      }))

    out.push({
      label: s3Detail.bucket,
      isResource: true,
      icon: <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      onClick: () => setS3(''),
    })
    const segments = s3Detail.prefix ? s3Detail.prefix.replace(/\/$/, '').split('/') : []

    segments.forEach((seg, i) => {
      const next = `${segments.slice(0, i + 1).join('/')}/`

      out.push({
        label: seg,
        isResource: true,
        icon: <Folder className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        onClick: i === segments.length - 1 ? undefined : () => setS3(next),
      })
    })
  }

  return out
}
