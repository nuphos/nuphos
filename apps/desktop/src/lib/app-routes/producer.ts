import { parseCustomResourceNavigationKey } from '../customResourceNavigation.ts'
import { clusterRouteForScope } from '../kubernetesClusterRoutes.ts'

import { customResourcePagePath, customResourceTypeForTarget } from './customResources.ts'
import { teamPageLocation } from './producerTeam.ts'
import {
  clusterPageSegment,
  ecsClusterPageSegment,
  pageLocation,
  pathSegment,
  resourceTargetPath,
  sectionSegment,
} from './sections.ts'
import { CLOUDFLARE_DETAIL_ACTIVE } from './types.ts'

import type { NavigationSnapshot, PageLocation, SshTerminalLocation } from './types.ts'

export function pageLocationForNavigation(
  navigation: NavigationSnapshot,
  tab?: { sshTerminal: SshTerminalLocation | null },
): PageLocation {
  const { scope, active, target } = navigation

  if (tab?.sshTerminal && scope.kind === 'aws-account') {
    const ssh = tab.sshTerminal
    const service = active === 'aws.ec2' ? 'ec2' : 'lightsail'

    return pageLocation(
      `/teams/${pathSegment(scope.teamId)}/infra/aws/${pathSegment(scope.accountId)}/${service}/${pathSegment(ssh.region)}/instances/${pathSegment(ssh.instanceName)}/ssh`,
    )
  }
  if (tab?.sshTerminal && scope.kind === 'gcp-project') {
    const ssh = tab.sshTerminal

    return pageLocation(
      `/teams/${pathSegment(scope.teamId)}/infra/gcp/${pathSegment(scope.projectId)}/gce/${pathSegment(ssh.region)}/instances/${pathSegment(ssh.instanceName)}/ssh`,
    )
  }

  switch (scope.kind) {
    case 'team':
      return teamPageLocation(navigation, scope)
    case 'aws-account': {
      if (active === 'aws.roles') {
        return pageLocation(
          `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.accountId)}/roles`,
        )
      }
      if (active === 'aws.role') {
        const roleSegment = scope.roleArn ?? scope.roleId

        return pageLocation(
          roleSegment
            ? `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.accountId)}/roles/${pathSegment(roleSegment)}`
            : `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.accountId)}/roles`,
        )
      }
      const base = `/teams/${pathSegment(scope.teamId)}/infra/aws/${pathSegment(scope.accountId)}/${sectionSegment('aws', active)}`
      const awsDetail = navigation.awsDetail ?? null

      if (
        awsDetail &&
        ((active === 'aws.lambda' && awsDetail.kind === 'lambda') ||
          (active === 'aws.cloudwatch' && awsDetail.kind === 'logGroup') ||
          (active === 'aws.cloudwatch-alarms' && awsDetail.kind === 'alarm'))
      ) {
        return pageLocation(
          `${base}/${pathSegment(awsDetail.region)}/${pathSegment(awsDetail.name)}`,
        )
      }
      if (active === 'aws.s3' && navigation.s3Detail) {
        const { bucket, prefix } = navigation.s3Detail
        const prefixSuffix = prefix
          ? `/${prefix.replace(/\/$/, '').split('/').map(pathSegment).join('/')}`
          : ''

        return pageLocation(`${base}/${pathSegment(bucket)}${prefixSuffix}`)
      }

      return pageLocation(base)
    }
    case 'azure-subscription':
      // Azure has no infra pages yet — the only section is the apps list under a
      // subscription (the analog of aws.roles).
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.subscriptionId)}/apps`,
      )
    case 'gcp-project':
      if (active === 'gcp.service-accounts') {
        return pageLocation(
          `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.projectId)}/service-accounts`,
        )
      }
      if (active === 'gcp.service-account' || active === 'gcp.iam') {
        return pageLocation(
          scope.serviceAccountId
            ? `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.projectId)}/service-accounts/${pathSegment(scope.serviceAccountId)}`
            : `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.projectId)}/service-accounts`,
        )
      }

      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/gcp/${pathSegment(scope.projectId)}/${sectionSegment('gcp', active)}`,
      )
    case 'cloudflare-account': {
      if (active === 'cloudflare.iam') {
        return pageLocation(
          `/teams/${pathSegment(scope.teamId)}/connectors/${pathSegment(scope.accountId)}/iam`,
        )
      }
      const cfBase = `/teams/${pathSegment(scope.teamId)}/infra/cloudflare/${pathSegment(scope.accountId)}/${sectionSegment('cloudflare', active)}`
      const cfDetail = navigation.cloudflareDetail ?? null

      if (cfDetail && active === CLOUDFLARE_DETAIL_ACTIVE[cfDetail.kind]) {
        if (cfDetail.kind === 'r2') {
          const prefixSuffix = cfDetail.prefix
            ? `/${cfDetail.prefix.replace(/\/$/, '').split('/').map(pathSegment).join('/')}`
            : ''

          return pageLocation(`${cfBase}/${pathSegment(cfDetail.name)}${prefixSuffix}`)
        }

        return pageLocation(`${cfBase}/${pathSegment(cfDetail.id ?? cfDetail.name)}`)
      }

      return pageLocation(cfBase)
    }
    case 'linode-account':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/linode/${pathSegment(scope.accountId)}/${sectionSegment('linode', active)}`,
      )
    case 'hetzner-account':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/hetzner/${pathSegment(scope.accountId)}/${sectionSegment('hetzner', active)}`,
      )
    case 'tencent-account':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/tencent/${pathSegment(scope.accountId)}/${sectionSegment('tencent', active)}`,
      )
    case 'aliyun-account':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/aliyun/${pathSegment(scope.accountId)}/${sectionSegment('aliyun', active)}`,
      )
    case 'volcengine-account':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/volcengine/${pathSegment(scope.accountId)}/${sectionSegment('volcengine', active)}`,
      )
    case 'betterstack-integration':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/betterstack/${pathSegment(scope.integrationId)}/${sectionSegment('betterstack', active)}`,
      )
    case 'uptime-kuma-instance':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/uptime-kuma/${pathSegment(scope.instanceId)}/${sectionSegment('uptime-kuma', active)}`,
      )
    case 'database-connection':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/mongodb/${pathSegment(scope.connectionId)}/${sectionSegment('mongodb', active)}`,
      )
    case 'compliance-integration': {
      const base = `/teams/${pathSegment(scope.teamId)}/compliance/${pathSegment(scope.provider)}/${pathSegment(scope.integrationId)}/tests`

      return pageLocation(target ? `${base}/${pathSegment(target.name)}` : base)
    }
    case 'tailscale-client':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/tailscale/${pathSegment(scope.clientId)}/${sectionSegment('tailscale', active)}`,
      )
    case 'zeabur-provider':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/zeabur/${pathSegment(scope.zeaburId)}/${sectionSegment('zeabur', active)}`,
      )
    case 'cloudflare-zone':
      return pageLocation(
        `/teams/${pathSegment(scope.teamId)}/infra/cloudflare/${pathSegment(scope.accountId)}/zones/${pathSegment(scope.zoneId)}/${sectionSegment('cloudflare', active)}`,
      )
    case 'cluster': {
      const cluster = clusterRouteForScope(scope)
      const base = `/teams/${pathSegment(scope.teamId)}/k8s/${pathSegment(cluster.provider)}/${pathSegment(cluster.connectionId)}/${pathSegment(cluster.region)}/${pathSegment(cluster.clusterId)}`
      const customResource =
        parseCustomResourceNavigationKey(active) ??
        (active === 'custom.resources' ? customResourceTypeForTarget(target) : null)
      // A CRD always has an API group; anything else degrades to the aggregate
      // page rather than smuggling a raw nav key into the path.
      const page = customResource
        ? (customResourcePagePath(customResource) ?? clusterPageSegment('custom.resources'))
        : clusterPageSegment(active)
      const path = target ? `${base}/${page}/${resourceTargetPath(target)}` : `${base}/${page}`

      return pageLocation(path, {
        namespace: scope.namespace,
        credential: cluster.credentialId,
      })
    }
    case 'aws-ecs-cluster': {
      const base = `/teams/${pathSegment(scope.teamId)}/infra/aws/${pathSegment(scope.accountId)}/ecs-clusters/${pathSegment(scope.region)}/${pathSegment(scope.clusterName)}`

      return pageLocation(`${base}/${ecsClusterPageSegment(active)}`)
    }
  }
}
