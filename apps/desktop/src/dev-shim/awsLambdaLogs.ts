/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendQuery, buildAtlasError, call, empty, noop } from './http.ts'

export function awsLambdaLogsMethods(): Record<string, any> {
  return {
    atlasInvokeAwsLambdaFunction: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      payload: string,
      roleId?: string,
    ) =>
      call(
        'POST',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/invoke`, {
          roleId,
        }),
        { region, name, payload },
      ),
    atlasUpdateAwsLambdaFunctionConfig: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
      roleId?: string,
    ) =>
      call(
        'PATCH',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/config`, {
          roleId,
        }),
        { region, name, ...updates },
      ),
    atlasGetAwsLambdaTriggers: (
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
        `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/triggers?${params.toString()}`,
      )
    },
    atlasSearchAwsLogGroupEvents: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      options: {
        pattern?: string
        startTime?: number
        endTime?: number
        stream?: string
        nextToken?: string
      },
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      params.set('name', name)
      if (roleId) params.set('roleId', roleId)
      if (options.pattern) params.set('pattern', options.pattern)
      if (options.startTime != null) params.set('startTime', String(options.startTime))
      if (options.endTime != null) params.set('endTime', String(options.endTime))
      if (options.stream) params.set('stream', options.stream)
      if (options.nextToken) params.set('nextToken', options.nextToken)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/log-groups/search?${params.toString()}`,
      )
    },
    atlasListAwsLogStreams: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      nextToken?: string,
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      params.set('name', name)
      if (nextToken) params.set('nextToken', nextToken)
      if (roleId) params.set('roleId', roleId)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/log-groups/streams?${params.toString()}`,
      )
    },
    atlasSetAwsLogGroupRetention: (
      teamId: string,
      accountId: string,
      region: string,
      name: string,
      retentionDays: number | null,
      roleId?: string,
    ) =>
      call(
        'PUT',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/log-groups/retention`, { roleId }),
        { region, name, retentionDays },
      ),
    atlasListAwsCloudWatchMetrics: (
      teamId: string,
      accountId: string,
      region: string,
      namespace?: string,
      metricName?: string,
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      if (namespace) params.set('namespace', namespace)
      if (metricName) params.set('metricName', metricName)
      if (roleId) params.set('roleId', roleId)

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-metrics?${params.toString()}`,
      ).then((d: any) => ({ metrics: d.metrics ?? [], truncated: d.truncated ?? false }))
    },
    atlasGetAwsCloudWatchMetricData: (
      teamId: string,
      accountId: string,
      region: string,
      query: {
        namespace: string
        metricName: string
        dimensions: Record<string, string>
        stat: string
        rangeMinutes?: number
      },
      roleId?: string,
    ) => {
      const params = new URLSearchParams()

      params.set('region', region)
      params.set('namespace', query.namespace)
      if (roleId) params.set('roleId', roleId)
      params.set('metricName', query.metricName)
      params.set('dimensions', JSON.stringify(query.dimensions))
      params.set('stat', query.stat)
      if (query.rangeMinutes != null) params.set('rangeMinutes', String(query.rangeMinutes))

      return call(
        'GET',
        `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-metric-data?${params.toString()}`,
      )
    },
    atlasGetAwsCloudWatchAlarmHistory: (
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
        `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-alarms/history?${params.toString()}`,
      ).then((d: any) => d.items ?? [])
    },
    atlasListAwsLogGroups: (teamId: string, accountId: string, region?: string, roleId?: string) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/aws-accounts/${accountId}/log-groups`, { region, roleId }),
      ).then((d: any) => d.logGroups ?? []),
    atlasGetAwsLogGroupEvents: (
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
        `/teams/${teamId}/aws-accounts/${accountId}/log-groups/events?${params.toString()}`,
      )
    },
    atlasListAwsLightsailInstances: (teamId: string, accountId: string, region?: string) => {
      const q = region ? `?region=${encodeURIComponent(region)}` : ''

      return call('GET', `/teams/${teamId}/aws-accounts/${accountId}/lightsail-instances${q}`).then(
        (d: any) => {
          const instances = d.instances ?? []
          const errors = d.errors ?? []

          if (instances.length === 0 && errors.length > 0) {
            const first = errors[0]
            const message =
              typeof first?.message === 'string' ? first.message : 'AWS returned an error'
            const operation = errors
              .map((e: any) => (typeof e?.message === 'string' ? e.message : ''))
              .map((m: string) => /\b([a-z][a-z0-9-]*:[A-Z*][A-Za-z0-9*]*)\b/.exec(m)?.[1])
              .find(Boolean)

            if (operation) {
              throw buildAtlasError(
                `The selected AWS role does not have permission to ${String(operation)}.`,
                'aws_role_permission_denied',
                {
                  provider: 'aws',
                  operation,
                  regions: errors.map((e: any) => e?.region).filter(Boolean),
                  upstreamMessage: message,
                },
              )
            }
            const where = first?.region ? ` in ${String(first.region)}` : ''

            throw new Error(`Cannot list Lightsail instances${where}: ${String(message)}`)
          }

          return instances
        },
      )
    },
    atlasRebootAwsLightsailInstance: (
      teamId: string,
      accountId: string,
      name: string,
      region: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/aws-accounts/${accountId}/lightsail-instances/${encodeURIComponent(name)}/reboot`,
        { region },
      ).then(() => undefined),
    atlasStartAwsLightsailSsh: () =>
      Promise.reject(new Error('Embedded Lightsail SSH is only available in the Electron app.')),
    atlasListGcpVpcs: () => empty([]),
    atlasListGcpFirewalls: () => empty([]),
    atlasListGcpClusters: () => empty([]),
    atlasUseAwsCluster: noop,
    atlasUseGcpCluster: noop,
  }
}
