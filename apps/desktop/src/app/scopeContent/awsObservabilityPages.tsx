import { faAlignLeft, faBell, faBolt, faChartLine } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { api } from '../../api'
import { awsResourceListCacheKey } from '../../app/accountScopes'
import { withResourceListCache } from '../../lib/resourceListCache'
import {
  CloudWatchAlarmsView,
  CloudWatchLogGroupsView,
  CloudWatchMetricsExplorerView,
  LambdaFunctionsView,
} from '../../views/CloudViews'

import type { ScopeRenderContext } from './context'

export function renderAwsObservabilityPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    awsDetail,
    setAwsDetail,
    onCount,
    onLoading,
    renderActiveNavPage,
    awsRoleId,
  } = ctx

  if (scope.kind !== 'aws-account') return undefined

  if (active === 'aws.lambda') {
    const lambdaDetail = awsDetail?.kind === 'lambda' ? awsDetail : null

    return renderActiveNavPage(
      lambdaDetail ? lambdaDetail.name : 'Lambda',
      <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
      <LambdaFunctionsView
        detail={lambdaDetail}
        setDetail={(d) => setAwsDetail(d ? { kind: 'lambda', ...d } : null)}
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'lambda-functions'),
          () =>
            api.atlasListAwsLambdaFunctions(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        detailLoader={(fn) =>
          api.atlasGetAwsLambdaFunctionDetail(
            scope.teamId,
            scope.accountId,
            fn.region,
            fn.name,
            awsRoleId,
          )
        }
        metricsLoader={(fn, rangeMinutes) =>
          api.atlasGetAwsLambdaFunctionMetrics(
            scope.teamId,
            scope.accountId,
            fn.region,
            fn.name,
            rangeMinutes,
            awsRoleId,
          )
        }
        eventsLoader={(group) =>
          api.atlasGetAwsLogGroupEvents(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            awsRoleId,
          )
        }
        searchLoader={(group, options) =>
          api.atlasSearchAwsLogGroupEvents(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            options,
            awsRoleId,
          )
        }
        streamsLoader={(group, nextToken) =>
          api.atlasListAwsLogStreams(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            nextToken,
            awsRoleId,
          )
        }
        invoker={(fn, payload) =>
          api.atlasInvokeAwsLambdaFunction(
            scope.teamId,
            scope.accountId,
            fn.region,
            fn.name,
            payload,
            awsRoleId,
          )
        }
        configUpdater={(fn, updates) =>
          api.atlasUpdateAwsLambdaFunctionConfig(
            scope.teamId,
            scope.accountId,
            fn.region,
            fn.name,
            updates,
            awsRoleId,
          )
        }
        triggersLoader={(fn) =>
          api.atlasGetAwsLambdaTriggers(
            scope.teamId,
            scope.accountId,
            fn.region,
            fn.name,
            awsRoleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'aws.cloudwatch-alarms') {
    const alarmDetail = awsDetail?.kind === 'alarm' ? awsDetail : null

    return renderActiveNavPage(
      alarmDetail ? alarmDetail.name : 'CloudWatch Alarms',
      <FontAwesomeIcon icon={faBell} className="w-3.5 h-3.5 text-tertiary" />,
      <CloudWatchAlarmsView
        detail={alarmDetail}
        setDetail={(d) => setAwsDetail(d ? { kind: 'alarm', ...d } : null)}
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'cloudwatch-alarms'),
          () =>
            api.atlasListAwsCloudWatchAlarms(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        metricDataLoader={(alarm, rangeMinutes) =>
          api.atlasGetAwsCloudWatchMetricData(
            scope.teamId,
            scope.accountId,
            alarm.region,
            {
              namespace: alarm.namespace ?? '',
              metricName: alarm.metricName ?? '',
              dimensions: alarm.dimensions,
              stat:
                alarm.statistic === 'Sum' ||
                alarm.statistic === 'Maximum' ||
                alarm.statistic === 'Minimum'
                  ? alarm.statistic
                  : 'Average',
              rangeMinutes,
            },
            awsRoleId,
          )
        }
        historyLoader={(alarm) =>
          api.atlasGetAwsCloudWatchAlarmHistory(
            scope.teamId,
            scope.accountId,
            alarm.region,
            alarm.name,
            awsRoleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'aws.cloudwatch-metrics') {
    return renderActiveNavPage(
      'CloudWatch Metrics',
      <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
      <CloudWatchMetricsExplorerView
        metricsLoader={(region, namespace) =>
          api.atlasListAwsCloudWatchMetrics(
            scope.teamId,
            scope.accountId,
            region,
            namespace,
            undefined,
            awsRoleId,
          )
        }
        dataLoader={(region, query) =>
          api.atlasGetAwsCloudWatchMetricData(
            scope.teamId,
            scope.accountId,
            region,
            query,
            awsRoleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'aws.cloudwatch') {
    const logGroupDetail = awsDetail?.kind === 'logGroup' ? awsDetail : null

    return renderActiveNavPage(
      logGroupDetail ? logGroupDetail.name : 'CloudWatch Logs',
      <FontAwesomeIcon icon={faAlignLeft} className="w-3.5 h-3.5 text-tertiary" />,
      <CloudWatchLogGroupsView
        detail={logGroupDetail}
        setDetail={(d) => setAwsDetail(d ? { kind: 'logGroup', ...d } : null)}
        loader={withResourceListCache(
          awsResourceListCacheKey(scope.teamId, scope.accountId, awsRoleId, 'log-groups'),
          () => api.atlasListAwsLogGroups(scope.teamId, scope.accountId, undefined, awsRoleId),
        )}
        eventsLoader={(group) =>
          api.atlasGetAwsLogGroupEvents(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            awsRoleId,
          )
        }
        searchLoader={(group, options) =>
          api.atlasSearchAwsLogGroupEvents(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            options,
            awsRoleId,
          )
        }
        streamsLoader={(group, nextToken) =>
          api.atlasListAwsLogStreams(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            nextToken,
            awsRoleId,
          )
        }
        setRetention={(group, retentionDays) =>
          api.atlasSetAwsLogGroupRetention(
            scope.teamId,
            scope.accountId,
            group.region,
            group.name,
            retentionDays,
            awsRoleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  return undefined
}
