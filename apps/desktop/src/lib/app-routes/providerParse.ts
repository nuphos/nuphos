import { emptyNavigation, SIMPLE_PROVIDER_ROUTES } from './parseShared.ts'
import { ECS_CLUSTER_PAGES, sectionForSegments } from './sections.ts'
import { CONNECTOR_INFO_LABELS, CONNECTOR_INFO_PROVIDERS, DEFAULT_KEY } from './types.ts'

import type { NavigationSnapshot } from './types.ts'
import type { Scope } from '../../types'

export function connectorsNavigation(
  teamId: string,
  inner: string[],
  query: URLSearchParams,
): NavigationSnapshot {
  const teamScope: Scope = { kind: 'team', teamId }

  if (inner.length === 0) {
    return emptyNavigation(teamScope, 'team.integrations', {
      ...(query.get('add-modal-opened') ? { addIntegrationOpen: true } : {}),
    })
  }
  const parentId = inner[0]

  if (inner[1] === 'roles') {
    const roleSegment = inner[2]

    if (roleSegment) {
      return emptyNavigation(
        {
          kind: 'aws-account',
          teamId,
          accountId: parentId,
          ...(roleSegment.startsWith('arn:') ? { roleArn: roleSegment } : { roleId: roleSegment }),
        },
        'aws.role',
      )
    }

    return emptyNavigation({ kind: 'aws-account', teamId, accountId: parentId }, 'aws.roles')
  }
  if (inner[1] === 'service-accounts') {
    const serviceAccountId = inner[2]

    return emptyNavigation(
      {
        kind: 'gcp-project',
        teamId,
        projectId: parentId,
        ...(serviceAccountId ? { serviceAccountId } : {}),
      },
      serviceAccountId ? 'gcp.service-account' : 'gcp.service-accounts',
    )
  }
  if (inner[1] === 'iam') {
    return emptyNavigation(
      { kind: 'cloudflare-account', teamId, accountId: parentId },
      'cloudflare.iam',
    )
  }
  if (inner[1] === 'apps') {
    return emptyNavigation(
      { kind: 'azure-subscription', teamId, subscriptionId: parentId },
      'azure.apps',
    )
  }
  const provider = CONNECTOR_INFO_PROVIDERS.find((item) => item === parentId)

  if (provider && inner[1]) {
    return emptyNavigation(teamScope, 'team.integrations', {
      connectorDetail: { provider, connectorId: inner[1], name: CONNECTOR_INFO_LABELS[provider] },
    })
  }

  return emptyNavigation(teamScope, 'team.integrations')
}

export function infraNavigation(teamId: string, inner: string[]): NavigationSnapshot | null {
  const [provider, parentId, ...pages] = inner

  if (!provider || !parentId) return null

  if (provider === 'aws') {
    const scope: Scope = { kind: 'aws-account', teamId, accountId: parentId }

    if (pages.length === 0) return emptyNavigation(scope)
    const section = pages[0]

    // SSH-terminal paths land on the instances list — a PTY can't be restored
    // from a URL, but the instance is one click away (pre-filtered).
    if ((section === 'ec2' || section === 'lightsail') && pages[2] === 'instances' && pages[3]) {
      return emptyNavigation(scope, section === 'ec2' ? 'aws.ec2' : 'aws.lightsail', {
        filter: pages[3],
      })
    }
    if (section === 'ecs-clusters' && pages[1] && pages[2]) {
      const ecsScope: Scope = {
        kind: 'aws-ecs-cluster',
        teamId,
        accountId: parentId,
        region: pages[1],
        clusterName: pages[2],
        clusterArn: '',
      }
      const active =
        pages[3] && ECS_CLUSTER_PAGES.includes(pages[3])
          ? `ecs.${pages[3]}`
          : DEFAULT_KEY['aws-ecs-cluster']

      return emptyNavigation(ecsScope, active)
    }
    if (section === 's3-buckets') {
      if (!pages[1]) return emptyNavigation(scope, 'aws.s3')
      const keyParts = pages.slice(2)

      // Drill-down state is always a folder prefix; restore the conventional
      // trailing slash the producer strips.
      return emptyNavigation(scope, 'aws.s3', {
        s3Detail: {
          bucket: pages[1],
          region: '',
          prefix: keyParts.length ? `${keyParts.join('/')}/` : '',
        },
      })
    }
    const entry = sectionForSegments('aws', pages)

    if (entry?.awsDetail && pages[1] && pages[2]) {
      return emptyNavigation(scope, entry.active, {
        awsDetail: { kind: entry.awsDetail, region: pages[1], name: pages[2] },
      })
    }

    return emptyNavigation(scope, entry?.active ?? DEFAULT_KEY['aws-account'])
  }

  if (provider === 'gcp') {
    const scope: Scope = { kind: 'gcp-project', teamId, projectId: parentId }

    if (pages.length === 0) return emptyNavigation(scope)
    const section = pages[0]

    if (section === 'gce' && pages[2] === 'instances' && pages[3]) {
      return emptyNavigation(scope, 'gcp.gce', { filter: pages[3] })
    }

    return emptyNavigation(
      scope,
      sectionForSegments('gcp', pages)?.active ?? DEFAULT_KEY['gcp-project'],
    )
  }

  if (provider === 'cloudflare') {
    const scope: Scope = { kind: 'cloudflare-account', teamId, accountId: parentId }

    if (pages.length === 0) return emptyNavigation(scope)
    const section = pages[0]

    if (section === 'zones' && pages[1]) {
      return emptyNavigation(
        {
          kind: 'cloudflare-zone',
          teamId,
          accountId: parentId,
          zoneId: pages[1],
          zoneName: pages[1],
        },
        'cloudflare.dns',
      )
    }
    const entry = sectionForSegments('cloudflare', pages)
    const detailKind = entry?.cloudflareDetail

    if (entry && detailKind && pages[1]) {
      if (detailKind === 'r2') {
        const keyParts = pages.slice(2)

        return emptyNavigation(scope, entry.active, {
          cloudflareDetail: {
            kind: 'r2',
            name: pages[1],
            ...(keyParts.length ? { prefix: `${keyParts.join('/')}/` } : {}),
          },
        })
      }

      return emptyNavigation(scope, entry.active, {
        cloudflareDetail:
          detailKind === 'd1' || detailKind === 'kv'
            ? { kind: detailKind, name: pages[1], id: pages[1] }
            : { kind: detailKind, name: pages[1] },
      })
    }

    return emptyNavigation(scope, entry?.active ?? DEFAULT_KEY['cloudflare-account'])
  }

  const simple = SIMPLE_PROVIDER_ROUTES[provider]

  if (simple) {
    const scope = simple.scope(teamId, parentId)

    if (pages.length === 0) return emptyNavigation(scope)

    return emptyNavigation(
      scope,
      sectionForSegments(provider, pages)?.active ?? DEFAULT_KEY[scope.kind],
    )
  }

  return null
}
