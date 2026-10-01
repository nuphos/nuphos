import { Hono } from 'hono'

import { requireAwsAccount, requireAwsMemberAccess } from '@/middleware/auth'
import { registerAwsAccessRoutes } from '@/routes/aws-accounts/access'
import { registerAwsBindRoutes } from '@/routes/aws-accounts/bind'
import { registerAwsComputeRoutes } from '@/routes/aws-accounts/compute'
import { registerAwsCredentialRoutes } from '@/routes/aws-accounts/credentials'
import { registerAwsEc2Routes } from '@/routes/aws-accounts/ec2'
import { registerAwsIamRoutes } from '@/routes/aws-accounts/iam'
import { registerAwsObservabilityRoutes } from '@/routes/aws-accounts/observability'
import { registerAwsResourceRoutes } from '@/routes/aws-accounts/resources'

import type { TeamAuthVariables, AwsAccountVariables } from '@/middleware/auth'

export { awsAccountsView } from '@/routes/aws-accounts/bind'

export const awsAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

registerAwsBindRoutes(awsAccountsRoutes)

const accountScoped = new Hono<{ Variables: AwsAccountVariables }>()

accountScoped.use('*', requireAwsAccount())

registerAwsAccessRoutes(accountScoped)
// Administrator-only, and registered before the member-access gate for the same
// reason /access is: managing a binding is not using it.

accountScoped.use('*', requireAwsMemberAccess())

registerAwsEc2Routes(accountScoped)
registerAwsCredentialRoutes(accountScoped)
registerAwsComputeRoutes(accountScoped)
registerAwsObservabilityRoutes(accountScoped)
registerAwsResourceRoutes(accountScoped)
registerAwsIamRoutes(accountScoped)

awsAccountsRoutes.route('/:accountId', accountScoped)
