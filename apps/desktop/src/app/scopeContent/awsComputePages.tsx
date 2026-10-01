import { Cloud, Container, KeyRound, Layers, Lightbulb, Server, ShieldCheck } from 'lucide-react'

import { api } from '../../api'
import { awsResourceListCacheKey } from '../../app/accountScopes'
import { withResourceListCache } from '../../lib/resourceListCache'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import {
  CloudFormationView,
  EC2InstancesView,
  EcsClustersView,
  LightsailInstancesView,
  NaclsView,
  VpcsView,
} from '../../views/CloudViews'
import { AzureAppsView } from '../../views/IamPermissionsView'

import type { ScopeRenderContext } from './context'

export function renderAwsComputePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    onOpenAgentChat,
    scope,
    active,
    filter,
    refreshKey,
    accounts,
    onCount,
    onLoading,
    onPickEcsCluster,
    onOpenLightsailSsh,
    onOpenEc2Ssh,
    onAccountsChanged,
    renderActiveNavPage,
    awsRoleId,
  } = ctx

  if (scope.kind === 'azure-subscription') {
    const apps = accounts?.azure.filter((a) => a.subscriptionId === scope.subscriptionId) ?? []

    return renderActiveNavPage(
      'Apps',
      <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <AzureAppsView
        onOpenAgentChat={onOpenAgentChat}
        teamId={scope.teamId}
        apps={apps}
        filter={filter}
        onCount={onCount}
        onChanged={onAccountsChanged}
      />,
    )
  }

  if (scope.kind !== 'aws-account') return undefined

  if (active === 'aws.vpcs') {
    return renderActiveNavPage(
      'VPCs',
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <VpcsView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'vpcs'),
          () => api.atlasListAwsVpcs(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(v) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/vpcs/${encodeURIComponent(v.id)}`,
          )
        }
      />,
    )
  }
  if (active === 'aws.nacls') {
    return renderActiveNavPage(
      'Network ACLs',
      <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <NaclsView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'nacls'),
          () =>
            api.atlasListAwsNacls(scope.teamId, scope.accountId, undefined, undefined, awsRoleId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(n) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/network-acls/${encodeURIComponent(n.id)}`,
          )
        }
      />,
    )
  }
  if (active === 'aws.ecs') {
    return renderActiveNavPage(
      'ECS Clusters',
      <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <EcsClustersView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'ecs-clusters'),
          () => api.atlasListAwsEcsClusters(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onPick={onPickEcsCluster}
        getRowLink={(c) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/ecs-clusters/${encodeURIComponent(c.region)}/${encodeURIComponent(c.clusterName)}/services`,
          )
        }
      />,
    )
  }
  if (active === 'aws.ec2') {
    return renderActiveNavPage(
      'EC2 Instances',
      <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <EC2InstancesView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'ec2-instances'),
          () => api.atlasListAwsEc2Instances(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        onOpenSsh={(instance) =>
          onOpenEc2Ssh({
            teamId: scope.teamId,
            accountId: scope.accountId,
            roleId: awsRoleId,
            instance,
          })
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(i) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/ec2-instances/${encodeURIComponent(i.instanceId)}`,
          )
        }
      />,
    )
  }
  if (active === 'aws.lightsail') {
    return renderActiveNavPage(
      'Lightsail',
      <Lightbulb className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <LightsailInstancesView
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'lightsail-instances'),
          () =>
            api.atlasListAwsLightsailInstances(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        onOpenSsh={(instance) =>
          onOpenLightsailSsh({
            teamId: scope.teamId,
            accountId: scope.accountId,
            roleId: awsRoleId,
            instance,
          })
        }
        onReboot={(instance) =>
          api.atlasRebootAwsLightsailInstance(
            scope.teamId,
            scope.accountId,
            instance.name,
            instance.region,
            awsRoleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(i) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/lightsail/${encodeURIComponent(i.region)}/instances/${encodeURIComponent(i.name)}`,
          )
        }
      />,
    )
  }
  if (active === 'aws.cloudformation') {
    return renderActiveNavPage(
      'CloudFormation',
      <Layers className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudFormationView
        loader={withResourceListCache(
          awsResourceListCacheKey(
            scope.teamId,
            scope.accountId,
            awsRoleId,
            'cloudformation-stacks',
          ),
          () => api.atlasListAwsCfnStacks(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        getRowLink={(s) =>
          toAbsoluteAtlasUrl(
            `/teams/${encodeURIComponent(scope.teamId)}/infra/aws/${encodeURIComponent(scope.accountId)}/cloudformation/${encodeURIComponent(s.region)}/${encodeURIComponent(s.stackName)}`,
          )
        }
      />,
    )
  }

  return undefined
}
