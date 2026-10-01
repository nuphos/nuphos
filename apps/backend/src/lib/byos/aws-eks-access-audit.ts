// aws-eks-access-audit.ts — attribution for the mutating EKS access calls the
// connector makes inside a customer account.
//
// CloudTrail records these as `<ConnectorRole>/nuphos-byos`, which identifies
// the connector session, not the human (or agent turn) that caused it. Since
// `CreateAccessEntry` / `AssociateAccessPolicy` / `UpdateClusterConfig` all
// trip high-risk-mutation monitoring, every one of them emits a structured log
// line here carrying the requesting user, team and agent session — plus the
// AWS request id, which is exactly the CloudTrail event's `requestID` field, so
// an alert can be joined 1:1 to the log line that explains who triggered it.

import { errorMessage, logEvent } from '@/lib/observability'

import { extractAwsAccountId } from './account'

export type EksAccessActor = {
  /** Entry point that triggered the call, e.g. `agent-sessions.aws.kubeconfig`. */
  source: string
  userId?: string
  userEmail?: string
  teamId?: string
  /** Agent chat session id, when the caller is an agent turn rather than the UI. */
  agentSessionId?: string
}

/** Shape of every AWS SDK v3 response; `requestId` is the CloudTrail join key. */
type AwsResponseMetadata = { $metadata?: { requestId?: string } }

export type EksAccessMutationOutcome =
  'created' | 'associated' | 'already_exists' | 'upgraded' | 'failed'

export type EksAccessMutationLog = {
  actor?: EksAccessActor
  region: string
  clusterName: string
  principalArn: string
  outcome: EksAccessMutationOutcome
  response?: AwsResponseMetadata
  policyArn?: string
  error?: unknown
}

/**
 * Emit one attribution record for a mutating EKS access call.
 *
 * Grep an alert back to a person with the AWS request id from the CloudTrail
 * event, e.g. `event="byos.aws.eks.*" aws_request_id="<requestID>"`, or sweep a
 * time window per cluster with `cluster_name="<name>"`.
 */
export function logEksAccessMutation(event: string, args: EksAccessMutationLog): void {
  logEvent(args.outcome === 'failed' ? 'warn' : 'info', event, {
    aws_account_id: extractAwsAccountId(args.principalArn),
    aws_region: args.region,
    cluster_name: args.clusterName,
    principal_arn: args.principalArn,
    policy_arn: args.policyArn,
    outcome: args.outcome,
    aws_request_id: args.response?.$metadata?.requestId,
    // `unattributed` means a caller reached this path without threading an
    // actor through — treat those as a bug, not as an anonymous user.
    actor_source: args.actor?.source ?? 'unattributed',
    actor_user_id: args.actor?.userId,
    actor_user_email: args.actor?.userEmail,
    actor_team_id: args.actor?.teamId,
    actor_agent_session_id: args.actor?.agentSessionId,
    ...(args.error === undefined ? {} : { error_message: errorMessage(args.error) }),
  })
}
