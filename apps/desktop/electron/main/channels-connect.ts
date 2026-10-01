import * as atlas from '../atlas'
import * as k8s from '../k8s'

export const connectChannels = {
  'atlas:useOnpremCluster': async (_e: unknown, teamId: string, clusterId: string) => {
    const context = await k8s.loadKubeconfigYaml(
      await atlas.getOnpremClusterKubeconfig(teamId, clusterId),
      `onprem/${teamId}/${clusterId}`,
      // The credential stored for an on-prem cluster is normally persistent,
      // but an administrator can replace it while an existing workspace tab
      // still has the old kubeconfig in memory. Re-fetch once after a 401 so
      // that tab picks up the replacement without having to be closed first.
      async () => ({ yaml: await atlas.getOnpremClusterKubeconfig(teamId, clusterId) }),
    )

    return { context }
  },
  'atlas:useLinodeCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    clusterId: number,
    clusterLabel: string,
  ) => {
    const yaml = await atlas.getLinodeLkeKubeconfig(teamId, accountId, clusterId)
    const context = await k8s.loadKubeconfigYaml(
      yaml,
      `${teamId}/linode/${accountId}/${String(clusterId)}`,
      async () => ({ yaml: await atlas.getLinodeLkeKubeconfig(teamId, accountId, clusterId) }),
    )

    return { context, label: clusterLabel }
  },
  // Clusters reached via an alternative API server endpoint —
  // e.g. a control-plane-ACL'd cluster whose only ingress is the Tailscale
  // operator's API server proxy, or any VPN/private DNS name. The endpoint
  // must authenticate at the network layer (the Tailscale proxy does
  // tailnet-identity impersonation), so the kubeconfig is credential-less —
  // same shape as `tailscale configure kubeconfig` writes. No refresh
  // callback: there is nothing to expire.
  'k8s:useClusterViaEndpoint': async (_e: unknown, host: string, clusterLabel: string) => {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
      throw new Error(`Invalid endpoint hostname: ${host}`)
    }
    const yamlText = [
      'apiVersion: v1',
      'kind: Config',
      'clusters:',
      '- cluster:',
      `    server: https://${host}`,
      `  name: ${host}`,
      'users:',
      '- name: endpoint-override-auth',
      '  user:',
      '    token: unused',
      'contexts:',
      '- context:',
      `    cluster: ${host}`,
      '    user: endpoint-override-auth',
      `  name: ${host}`,
      `current-context: ${host}`,
      '',
    ].join('\n')
    const context = await k8s.loadKubeconfigYaml(yamlText, host)

    return { context, label: clusterLabel }
  },
  'atlas:useAwsCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    name: string,
    region?: string,
    roleId?: string,
  ) => {
    const r = await atlas.getAwsClusterKubeconfig(teamId, accountId, name, region, roleId)
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `aws/${teamId}/${accountId}/${roleId ?? 'auto'}/${name}`,
      () => atlas.getAwsClusterKubeconfig(teamId, accountId, name, region, roleId),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:useGcpCluster': async (
    _e: unknown,
    teamId: string,
    projectId: string,
    name: string,
    location?: string,
    serviceAccountId?: string,
  ) => {
    const r = await atlas.getGcpClusterKubeconfig(
      teamId,
      projectId,
      name,
      location,
      serviceAccountId,
    )
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `gcp/${teamId}/${projectId}/${serviceAccountId ?? 'auto'}/${name}`,
      () => atlas.getGcpClusterKubeconfig(teamId, projectId, name, location, serviceAccountId),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:useTencentCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
  ) => {
    const r = await atlas.getTencentClusterKubeconfig(teamId, accountId, clusterId, region)
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `tencent/${teamId}/${accountId}/${clusterId}`,
      () => atlas.getTencentClusterKubeconfig(teamId, accountId, clusterId, region),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:useAzureCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    clusterName: string,
    resourceGroup?: string,
  ) => {
    const r = await atlas.getAzureClusterKubeconfig(teamId, accountId, clusterName, resourceGroup)
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      // Include the resource group: AKS clusters are addressed by (resourceGroup,
      // name), so two same-named clusters in different groups must not alias to
      // the same local context.
      `azure/${teamId}/${accountId}/${resourceGroup ?? '_'}/${clusterName}`,
      () => atlas.getAzureClusterKubeconfig(teamId, accountId, clusterName, resourceGroup),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:useAliyunCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
  ) => {
    const r = await atlas.getAliyunClusterKubeconfig(teamId, accountId, clusterId, region)
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `aliyun/${teamId}/${accountId}/${clusterId}`,
      () => atlas.getAliyunClusterKubeconfig(teamId, accountId, clusterId, region),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:useVolcengineCluster': async (
    _e: unknown,
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
    fresh?: boolean,
  ) => {
    const r = await atlas.getVolcengineClusterKubeconfig(
      teamId,
      accountId,
      clusterId,
      region,
      fresh,
    )
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `volcengine/${teamId}/${accountId}/${clusterId}`,
      () => atlas.getVolcengineClusterKubeconfig(teamId, accountId, clusterId, region),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
} as const
