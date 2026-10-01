/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendQuery, call } from './http.ts'

export function awsInfraMethods(): Record<string, any> {
  return {
    atlasListAwsVpcs: (teamId: string, accountId: string, region?: string) => {
      const q = region ? `?region=${encodeURIComponent(region)}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/vpcs${q}`).then(
        (d: any) => d.vpcs ?? [],
      )
    },
    atlasListAwsNacls: (teamId: string, accountId: string, region?: string, vpcId?: string) => {
      const params = new URLSearchParams()

      if (region) params.set('region', region)
      if (vpcId) params.set('vpcId', vpcId)
      const q = params.toString() ? `?${params}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/nacls${q}`).then(
        (d: any) => d.nacls ?? [],
      )
    },
    atlasListAwsClusters: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/aws-accounts/${accountId}/clusters`).then(
        (d: any) => d.clusters ?? [],
      ),
    atlasListAwsEc2Instances: (teamId: string, accountId: string, region?: string) => {
      const q = region ? `?region=${encodeURIComponent(region)}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/ec2-instances${q}`).then(
        (d: any) => d.instances ?? [],
      )
    },
    atlasListAwsEcsClusters: (teamId: string, accountId: string, region?: string) => {
      const q = region ? `?region=${encodeURIComponent(region)}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters${q}`).then(
        (d: any) => d.clusters ?? [],
      )
    },
    atlasListAwsEcsServices: (
      teamId: string,
      accountId: string,
      region: string,
      clusterName: string,
    ) =>
      call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters/${encodeURIComponent(region)}/${encodeURIComponent(clusterName)}/services`,
      ).then((d: any) => d.services ?? []),
    atlasListAwsEcsTasks: (
      teamId: string,
      accountId: string,
      region: string,
      clusterName: string,
      desiredStatus?: 'RUNNING' | 'STOPPED',
    ) => {
      const q = desiredStatus ? `?desiredStatus=${desiredStatus}` : ''

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters/${encodeURIComponent(region)}/${encodeURIComponent(clusterName)}/tasks${q}`,
      ).then((d: any) => d.tasks ?? [])
    },
    atlasListAwsEcsContainerInstances: (
      teamId: string,
      accountId: string,
      region: string,
      clusterName: string,
    ) =>
      call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters/${encodeURIComponent(region)}/${encodeURIComponent(clusterName)}/container-instances`,
      ).then((d: any) => d.instances ?? []),
    atlasGetAwsEcsClusterMetrics: (
      teamId: string,
      accountId: string,
      region: string,
      clusterName: string,
      rangeMinutes?: number,
    ) => {
      const q = rangeMinutes ? `?rangeMinutes=${String(rangeMinutes)}` : ''

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/ecs-clusters/${encodeURIComponent(region)}/${encodeURIComponent(clusterName)}/metrics${q}`,
      )
    },
    atlasListAwsCfnStacks: (teamId: string, accountId: string, region?: string) => {
      const q = region ? `?region=${encodeURIComponent(region)}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/cfn-stacks${q}`).then(
        (d: any) => d.stacks ?? [],
      )
    },
    atlasListAwsS3Buckets: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets`).then(
        (d: any) => d.buckets ?? [],
      ),
    atlasListAwsS3BucketObjects: (
      teamId: string,
      accountId: string,
      bucket: string,
      region: string,
      prefix: string,
      continuationToken: string | null,
    ) => {
      const params = new URLSearchParams()

      if (region) params.set('region', region)
      if (prefix) params.set('prefix', prefix)
      if (continuationToken) params.set('continuationToken', continuationToken)
      const qs = params.toString()
      const query = qs ? `?${qs}` : ''

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/objects${query}`,
      )
    },
    atlasGetAwsS3ObjectDownloadUrl: (
      teamId: string,
      accountId: string,
      bucket: string,
      region: string,
      key: string,
    ) => {
      const params = new URLSearchParams()

      if (region) params.set('region', region)
      params.set('key', key)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/object-url?${params.toString()}`,
      ).then((d: any) => d.url as string)
    },
    atlasGetAwsS3ObjectPreview: (
      teamId: string,
      accountId: string,
      bucket: string,
      region: string,
      key: string,
    ) => {
      const params = new URLSearchParams()

      if (region) params.set('region', region)
      params.set('key', key)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/object-preview?${params.toString()}`,
      )
    },
    atlasListAwsLambdaFunctions: (
      teamId: string,
      accountId: string,
      region?: string,
      roleId?: string,
    ) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/lambda-functions`, {
          region,
          roleId,
        }),
      ).then((d: any) => d.functions ?? []),
    atlasGetAwsLambdaFunctionDetail: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      params.set('name', name)
      if (roleId) params.set('roleId', roleId)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function?${params.toString()}`,
      )
    },
    atlasGetAwsLambdaFunctionMetrics: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      rangeMinutes?: number,
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      params.set('name', name)
      if (rangeMinutes != null) params.set('rangeMinutes', String(rangeMinutes))
      if (roleId) params.set('roleId', roleId)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/metrics?${params.toString()}`,
      )
    },
    atlasListAwsCloudWatchAlarms: (
      teamId: string,
      accountId: string,
      region?: string,
      roleId?: string,
    ) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-alarms`, {
          region,
          roleId,
        }),
      ).then((d: any) => d.alarms ?? []),
  }
}
