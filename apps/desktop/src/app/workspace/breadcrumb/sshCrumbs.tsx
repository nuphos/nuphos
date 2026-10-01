import { Globe, Lightbulb, Server, Terminal } from 'lucide-react'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { BreadcrumbSegment } from '../../../components/Toolbar'

export function pushZoneAndSshCrumbs(ctx: BreadcrumbContext, out: BreadcrumbSegment[]): boolean {
  const {
    scope,
    active,
    enterScope,
    sshTerminal,
    ec2InstancesByAccount,
    lightsailInstancesByAccount,
    gceInstancesByProject,
    loadEc2InstancesForAccount,
    loadLightsailInstancesForAccount,
    loadGceInstancesForProject,
    openEc2SshTab,
    openLightsailSshTab,
    openGceSshTab,
  } = ctx

  if (scope.kind === 'cloudflare-zone') {
    out.push(
      {
        label: 'Zones',
        icon: <Globe className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        onClick: () =>
          enterScope(
            {
              kind: 'cloudflare-account',
              teamId: scope.teamId,
              accountId: scope.accountId,
            },
            'cloudflare.zones',
          ),
      },
      {
        label: scope.zoneName,
        isResource: true,
        icon: <Globe className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
    )
  }

  if (sshTerminal) {
    const serviceLabel =
      active === 'aws.ec2'
        ? 'EC2'
        : active === 'aws.lightsail'
          ? 'Lightsail'
          : active === 'gcp.gce'
            ? 'Compute Engine'
            : 'Instances'
    const serviceIcon =
      active === 'aws.lightsail' ? (
        <Lightbulb className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
      ) : (
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
      )

    let instanceOptions: BreadcrumbSegment['options']
    let instancesLoading = false
    let onExpandInstances: (() => void) | undefined

    if (active === 'aws.ec2' && scope.kind === 'aws-account') {
      const key = `${scope.teamId}/${scope.accountId}`
      const items = ec2InstancesByAccount[key]

      instancesLoading = items === undefined
      onExpandInstances = () => loadEc2InstancesForAccount(scope.teamId, scope.accountId)
      instanceOptions = (items ?? [])
        .filter(
          (i) =>
            i.state === 'running' &&
            i.publicIp &&
            (i.platform ?? 'linux').toLowerCase() !== 'windows',
        )
        .map((i) => ({
          key: i.instanceId,
          label: i.tags.Name || i.instanceId,
          sublabel: `${i.instanceId} · ${i.availabilityZone || i.region}`,
          icon: serviceIcon,
          selected: i.instanceId === sshTerminal.instanceName,
          onPick: () =>
            openEc2SshTab({
              teamId: scope.teamId,
              accountId: scope.accountId,
              instance: i,
            }),
        }))
    } else if (active === 'aws.lightsail' && scope.kind === 'aws-account') {
      const key = `${scope.teamId}/${scope.accountId}`
      const items = lightsailInstancesByAccount[key]

      instancesLoading = items === undefined
      onExpandInstances = () => loadLightsailInstancesForAccount(scope.teamId, scope.accountId)
      instanceOptions = (items ?? [])
        .filter((i) => Boolean(i.username) && Boolean(i.publicIp))
        .map((i) => ({
          key: i.name,
          label: i.name,
          sublabel: i.region,
          icon: serviceIcon,
          selected: i.name === sshTerminal.instanceName,
          onPick: () =>
            openLightsailSshTab({
              teamId: scope.teamId,
              accountId: scope.accountId,
              instance: i,
            }),
        }))
    } else if (active === 'gcp.gce' && scope.kind === 'gcp-project') {
      const key = `${scope.teamId}/${scope.projectId}`
      const items = gceInstancesByProject[key]

      instancesLoading = items === undefined
      onExpandInstances = () => loadGceInstancesForProject(scope.teamId, scope.projectId)
      instanceOptions = (items ?? [])
        .filter((i) => i.status === 'RUNNING' && Boolean(i.publicIp))
        .map((i) => ({
          key: `${i.zone}/${i.name}`,
          label: i.name,
          sublabel: i.zone,
          icon: serviceIcon,
          selected: i.name === sshTerminal.instanceName,
          onPick: () =>
            openGceSshTab({
              teamId: scope.teamId,
              projectId: scope.projectId,
              instance: i,
            }),
        }))
    }

    out.push(
      {
        label: serviceLabel,
        icon: serviceIcon,
        onClick: () => enterScope(scope, active),
      },
      {
        label: sshTerminal.instanceName,
        isResource: true,
        icon: serviceIcon,
        loading: instancesLoading,
        options: instanceOptions,
        onExpand: onExpandInstances,
        emptyText: 'No SSH-able instances',
      },
      {
        label: 'SSH',
        icon: <Terminal className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
    )

    return true
  }

  return false
}
