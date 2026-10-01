import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  PutCompositeAlarmCommand,
  PutMetricAlarmCommand,
} from '@aws-sdk/client-cloudwatch'
import {
  DeleteTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns'

import { extractAwsAccountId } from '@/lib/byos/account'
import { assumeRoleAsConnector } from '@/lib/byos/aws'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import {
  buildCompositeAlarmUpdateWithoutTopic,
  buildMetricAlarmUpdateWithoutTopic,
  isAwsNotFound,
  settleAwsReadback,
} from './aws-alarm-update'
import { cleanupConflict, sameJson, targetsManagedWebhook } from './shared'

import type { AwsProviderWiring } from '../trigger-provider-wiring'
import type { CompositeAlarm, MetricAlarm } from '@aws-sdk/client-cloudwatch'
import type { Subscription } from '@aws-sdk/client-sns'
import type { ObjectId } from 'mongodb'

async function listAwsTopicSubscriptions(
  client: SNSClient,
  topicArn: string,
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = []
  let nextToken: string | undefined

  do {
    const page = await client.send(
      new ListSubscriptionsByTopicCommand({
        TopicArn: topicArn,
        NextToken: nextToken,
      }),
    )

    subscriptions.push(...(page.Subscriptions ?? []))
    nextToken = page.NextToken
  } while (nextToken)

  return subscriptions
}

function awsAlarmMatchesReceipt(
  alarm: MetricAlarm | CompositeAlarm,
  receipt: AwsProviderWiring,
): boolean {
  return alarm.AlarmName === receipt.alarmName && alarm.AlarmArn === receipt.alarmArn
}

function actionArraysMatch(
  before: MetricAlarm | CompositeAlarm,
  after: MetricAlarm | CompositeAlarm,
): boolean {
  return (
    sameJson(before.AlarmActions ?? [], after.AlarmActions ?? []) &&
    sameJson(before.OKActions ?? [], after.OKActions ?? []) &&
    sameJson(before.InsufficientDataActions ?? [], after.InsufficientDataActions ?? [])
  )
}

export async function cleanupAws(
  teamId: ObjectId,
  triggerId: string,
  receipt: AwsProviderWiring,
): Promise<void> {
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { awsRoles: 1 } })
  const binding = (doc?.awsRoles ?? []).find(
    (item) =>
      item.id.toHexString() === receipt.integrationId &&
      item.purpose !== 'permission-admin' &&
      extractAwsAccountId(item.roleArn) === receipt.accountId,
  )

  if (!binding) cleanupConflict('The AWS integration used by this Watch is no longer connected')

  const credentials = await assumeRoleAsConnector(binding.roleArn, {
    sessionName: `nuphos-watch-cleanup-${triggerId.slice(-12)}`,
  })
  const cloudWatch = new CloudWatchClient({ region: receipt.region, credentials })
  const sns = new SNSClient({ region: receipt.region, credentials })

  const described = await cloudWatch.send(
    new DescribeAlarmsCommand({
      AlarmNames: [receipt.alarmName],
      AlarmTypes: [receipt.alarmKind === 'metric' ? 'MetricAlarm' : 'CompositeAlarm'],
    }),
  )
  const initialAlarm =
    receipt.alarmKind === 'metric' ? described.MetricAlarms?.[0] : described.CompositeAlarms?.[0]

  if (initialAlarm) {
    if (!awsAlarmMatchesReceipt(initialAlarm, receipt)) {
      cleanupConflict('The CloudWatch alarm no longer matches the Watch ownership receipt')
    }
    const shouldUpdate =
      (receipt.attachedActions.includes('alarm') &&
        (initialAlarm.AlarmActions ?? []).includes(receipt.snsTopicArn)) ||
      (receipt.attachedActions.includes('ok') &&
        (initialAlarm.OKActions ?? []).includes(receipt.snsTopicArn))

    if (shouldUpdate) {
      const preflight = await cloudWatch.send(
        new DescribeAlarmsCommand({
          AlarmNames: [receipt.alarmName],
          AlarmTypes: [receipt.alarmKind === 'metric' ? 'MetricAlarm' : 'CompositeAlarm'],
        }),
      )
      const currentAlarm =
        receipt.alarmKind === 'metric'
          ? preflight.MetricAlarms?.[0]
          : preflight.CompositeAlarms?.[0]

      if (
        !currentAlarm ||
        !awsAlarmMatchesReceipt(currentAlarm, receipt) ||
        !actionArraysMatch(initialAlarm, currentAlarm)
      ) {
        cleanupConflict(
          'CloudWatch alarm actions changed while cleanup was preparing; retry after reviewing them',
        )
      }
      if (receipt.alarmKind === 'metric') {
        await cloudWatch.send(
          new PutMetricAlarmCommand(
            buildMetricAlarmUpdateWithoutTopic(currentAlarm as MetricAlarm, receipt),
          ),
        )
      } else {
        await cloudWatch.send(
          new PutCompositeAlarmCommand(
            buildCompositeAlarmUpdateWithoutTopic(currentAlarm as CompositeAlarm, receipt),
          ),
        )
      }
    }
  }

  const alarmAfter = await cloudWatch.send(
    new DescribeAlarmsCommand({
      AlarmNames: [receipt.alarmName],
      AlarmTypes: [receipt.alarmKind === 'metric' ? 'MetricAlarm' : 'CompositeAlarm'],
    }),
  )
  const verifiedAlarm =
    receipt.alarmKind === 'metric' ? alarmAfter.MetricAlarms?.[0] : alarmAfter.CompositeAlarms?.[0]

  if (
    verifiedAlarm &&
    ((receipt.attachedActions.includes('alarm') &&
      (verifiedAlarm.AlarmActions ?? []).includes(receipt.snsTopicArn)) ||
      (receipt.attachedActions.includes('ok') &&
        (verifiedAlarm.OKActions ?? []).includes(receipt.snsTopicArn)))
  ) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'CloudWatch alarm still targets the Nuphos SNS topic',
    )
  }

  let subscriptions: Subscription[]

  try {
    subscriptions = await listAwsTopicSubscriptions(sns, receipt.snsTopicArn)
  } catch (error) {
    if (!isAwsNotFound(error)) throw error
    subscriptions = []
  }
  const subscription = subscriptions.find(
    (item) => item.SubscriptionArn === receipt.snsSubscriptionArn,
  )

  if (subscription) {
    if (
      !targetsManagedWebhook(subscription.Endpoint, triggerId) ||
      (subscription.Protocol !== 'https' && subscription.Protocol !== 'http')
    ) {
      cleanupConflict('The SNS subscription no longer belongs to this Watch')
    }
    try {
      await sns.send(new UnsubscribeCommand({ SubscriptionArn: receipt.snsSubscriptionArn }))
    } catch (error) {
      if (!isAwsNotFound(error)) throw error
    }
  }

  const subscriptionsAfter = await settleAwsReadback(
    async () => {
      try {
        return await listAwsTopicSubscriptions(sns, receipt.snsTopicArn)
      } catch (error) {
        if (!isAwsNotFound(error)) throw error

        return []
      }
    },
    (items) => !items.some((item) => item.SubscriptionArn === receipt.snsSubscriptionArn),
  )

  if (subscriptionsAfter.some((item) => item.SubscriptionArn === receipt.snsSubscriptionArn)) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'SNS subscription still exists after deletion',
    )
  }

  // A topic created for this Watch is deleted only while it remains dedicated
  // to the Watch. If another subscription was added later, preserve the topic
  // and that unrelated routing rather than making trigger removal destructive.
  if (receipt.snsTopicOrigin === 'created' && subscriptionsAfter.length === 0) {
    try {
      await sns.send(new DeleteTopicCommand({ TopicArn: receipt.snsTopicArn }))
    } catch (error) {
      if (!isAwsNotFound(error)) throw error
    }
    const topicDeleted = await settleAwsReadback(
      async () => {
        try {
          await sns.send(new GetTopicAttributesCommand({ TopicArn: receipt.snsTopicArn }))

          return false
        } catch (error) {
          if (isAwsNotFound(error)) return true
          throw error
        }
      },
      (deleted) => deleted,
    )

    if (!topicDeleted) {
      throw new AppError(
        502,
        'provider_cleanup_verification_failed',
        'SNS topic still exists after deletion',
      )
    }
  }
}
