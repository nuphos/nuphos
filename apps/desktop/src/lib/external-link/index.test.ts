import assert from 'node:assert/strict'
import { test } from 'node:test'

import { navigationFromAppPath } from '../appRoutes.ts'

import { appPathForExternalLink, isBindableGithubLink, isBindableLinearLink } from './index.ts'

import type { BoundResources } from './index.ts'
import type {
  AwsAccount,
  CloudflareAccount,
  GcpProject,
  GithubInstallation,
  GrafanaInstance,
  LinearWorkspace,
} from '../../types'

const installation = (installationId: number, accountLogin: string): GithubInstallation => ({
  id: String(installationId),
  installationId,
  accountLogin,
  accountType: 'Organization',
  accountId: installationId,
  targetType: 'selected',
})

const grafana = (id: string, grafanaUrl: string): GrafanaInstance => ({
  id,
  name: id,
  grafanaUrl,
})

const awsAccount = (accountId: string): AwsAccount => ({
  roleId: `role-${accountId}`,
  accountId,
  roleArn: `arn:aws:iam::${accountId}:role/nuphos`,
})

const gcpProject = (projectId: string): GcpProject => ({
  serviceAccountId: `sa-${projectId}`,
  projectId,
  serviceAccountEmail: `nuphos@${projectId}.iam.gserviceaccount.com`,
})

const cloudflareAccount = (accountId: string): CloudflareAccount => ({
  id: `binding-${accountId}`,
  accountId,
  accountName: null,
  authType: 'api_token',
})

const linearWorkspace = (id: string, organizationUrlKey: string | null): LinearWorkspace => ({
  id,
  label: organizationUrlKey ?? id,
  workspaceId: `ws-${id}`,
  workspaceName: organizationUrlKey ?? id,
  organizationUrlKey,
  accountName: null,
  scope: 'read,write',
})

const bound = (extra: Partial<BoundResources> = {}): BoundResources => ({
  github: [installation(7, 'Zeabur')],
  grafana: [grafana('graf-1', 'https://metrics.example.test/grafana')],
  aws: [awsAccount('123456789012')],
  gcp: [gcpProject('nuphos-prod')],
  cloudflare: [cloudflareAccount('cf-account-1')],
  linear: [linearWorkspace('linear-1', 'zeabur')],
  ...extra,
})

const resolve = (href: string, resources: BoundResources = bound()): string | null =>
  appPathForExternalLink(href, 'team-1', resources)

test('maps GitHub links to the bound installation, and only pages the app has', () => {
  assert.equal(
    resolve('https://github.com/zeabur/nuphos/pull/42/files?diff=split'),
    '/teams/team-1/repository/installations/7/repos/Zeabur/nuphos/pull-requests/42?state=all',
  )
  assert.equal(
    resolve('https://github.com/Zeabur/nuphos'),
    '/teams/team-1/repository/installations/7/repos/Zeabur/nuphos',
  )
  assert.equal(
    resolve('https://github.com/Zeabur/nuphos/actions/runs/123'),
    '/teams/team-1/repository/installations/7/repos/Zeabur/nuphos/workflows',
  )
  // An unbound owner, and pages with no in-app twin, stay in the browser.
  assert.equal(resolve('https://github.com/someone-else/repo/pull/1'), null)
  assert.equal(resolve('https://github.com/Zeabur/nuphos/issues/42'), null)
  assert.equal(resolve('https://github.com.evil.test/Zeabur/nuphos/pull/42'), null)
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- an insecure URL is the input under test
  assert.equal(resolve('http://github.com/Zeabur/nuphos/pull/42'), null)
})

test('matches Grafana by bound URL, sub-path and all', () => {
  assert.equal(
    resolve('https://metrics.example.test/grafana/d/abc123/cluster-overview?from=now-1h'),
    '/teams/team-1/observability/grafana/graf-1/dashboards/abc123',
  )
  assert.equal(
    resolve('https://metrics.example.test/grafana/alerting/list'),
    '/teams/team-1/observability/grafana/graf-1/alerts',
  )
  assert.equal(
    resolve('https://metrics.example.test/grafana/connections/datasources/loki'),
    '/teams/team-1/observability/grafana/graf-1/datasources',
  )
  // Overlapping bindings on one host: the sub-path instance owns this URL
  // whichever order the bindings happen to be listed in.
  const origin = grafana('graf-origin', 'https://metrics.example.test')
  const subPath = grafana('graf-sub', 'https://metrics.example.test/grafana')

  for (const instances of [
    [origin, subPath],
    [subPath, origin],
  ]) {
    assert.equal(
      resolve('https://metrics.example.test/grafana/d/abc123/x', bound({ grafana: instances })),
      '/teams/team-1/observability/grafana/graf-sub/dashboards/abc123',
    )
    assert.equal(
      resolve('https://metrics.example.test/d/zzz/y', bound({ grafana: instances })),
      '/teams/team-1/observability/grafana/graf-origin/dashboards/zzz',
    )
  }
  // Another host, and a Grafana page the app has no twin for.
  assert.equal(resolve('https://other.example.test/grafana/d/abc123/x'), null)
  assert.equal(resolve('https://metrics.example.test/grafana/admin/users'), null)
  // With nothing bound there is nothing to match.
  assert.equal(resolve('https://metrics.example.test/d/abc123/x', bound({ grafana: [] })), null)
})

test('names the AWS account from the link, or from a sole binding', () => {
  assert.equal(
    resolve('https://us-east-1.console.aws.amazon.com/ec2/v2/home?region=us-east-1#Instances:'),
    '/teams/team-1/infra/aws/123456789012/ec2-instances',
  )
  assert.equal(
    resolve(
      'https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/checkout',
    ),
    '/teams/team-1/infra/aws/123456789012/lambda-functions/us-east-1/checkout',
  )
  assert.equal(
    resolve(
      'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fcheckout',
    ),
    '/teams/team-1/infra/aws/123456789012/log-groups/us-east-1/%2Faws%2Flambda%2Fcheckout',
  )
  assert.equal(
    resolve('https://s3.console.aws.amazon.com/s3/buckets/assets?prefix=images/icons/'),
    '/teams/team-1/infra/aws/123456789012/s3-buckets/assets/images/icons',
  )
  // Two bindings and no account id in the link: nothing to pick.
  const twoAccounts = bound({ aws: [awsAccount('123456789012'), awsAccount('210987654321')] })

  assert.equal(
    resolve('https://us-east-1.console.aws.amazon.com/ec2/v2/home?region=us-east-1', twoAccounts),
    null,
  )
  assert.equal(
    resolve(
      'https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/arn:aws:lambda:us-east-1:210987654321:function:checkout',
      twoAccounts,
    ),
    '/teams/team-1/infra/aws/210987654321/lambda-functions/us-east-1/arn%3Aaws%3Alambda%3Aus-east-1%3A210987654321%3Afunction%3Acheckout',
  )
  assert.equal(resolve('https://console.aws.amazon.com/billing/home'), null)
})

test('names the GCP project from ?project=', () => {
  assert.equal(
    resolve('https://console.cloud.google.com/compute/instances?project=nuphos-prod'),
    '/teams/team-1/infra/gcp/nuphos-prod/gce-instances',
  )
  assert.equal(
    resolve('https://console.cloud.google.com/monitoring/dashboards?project=nuphos-prod'),
    '/teams/team-1/infra/gcp/nuphos-prod/dashboards',
  )
  assert.equal(
    resolve('https://console.cloud.google.com/kubernetes/list/overview'),
    '/teams/team-1/infra/gcp/nuphos-prod/gke-clusters',
  )
  assert.equal(
    resolve('https://console.cloud.google.com/compute/instances?project=someone-elses'),
    null,
  )
  assert.equal(resolve('https://console.cloud.google.com/billing?project=nuphos-prod'), null)
})

test('matches Cloudflare by the account id in the dash URL', () => {
  assert.equal(
    resolve('https://dash.cloudflare.com/cf-account-1/workers/services/view/api-gateway'),
    '/teams/team-1/infra/cloudflare/cf-account-1/workers/api-gateway',
  )
  assert.equal(
    resolve('https://dash.cloudflare.com/cf-account-1/r2/default/buckets/uploads'),
    '/teams/team-1/infra/cloudflare/cf-account-1/r2/uploads',
  )
  // An unbound account, and a zone page the app addresses by id rather than name.
  assert.equal(resolve('https://dash.cloudflare.com/cf-other/workers'), null)
  assert.equal(resolve('https://dash.cloudflare.com/cf-account-1/example.test/dns/records'), null)
})

test('every produced path parses back into a navigation', () => {
  for (const href of [
    'https://github.com/Zeabur/nuphos/pull/42',
    'https://github.com/Zeabur/nuphos/actions',
    'https://metrics.example.test/grafana/d/abc123/cluster-overview',
    'https://metrics.example.test/grafana/alerting/list',
    'https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions/checkout',
    'https://s3.console.aws.amazon.com/s3/buckets/assets?prefix=images/',
    'https://console.cloud.google.com/run?project=nuphos-prod',
    'https://dash.cloudflare.com/cf-account-1/workers/services/view/api-gateway',
    'https://dash.cloudflare.com/cf-account-1/r2/default/buckets/uploads',
    'https://linear.app/zeabur/issue/NUPS-123/some-title',
  ]) {
    const path = resolve(href)

    assert.ok(path, `no path for ${href}`)
    assert.ok(navigationFromAppPath(path), `unparseable path for ${href}: ${path}`)
  }
})

test('isBindableGithubLink covers the pages the resolver can host', () => {
  assert.equal(isBindableGithubLink('https://github.com/Zeabur/nuphos/pull/42'), true)
  assert.equal(isBindableGithubLink('https://github.com/Zeabur/nuphos/issues/42'), false)
  assert.equal(isBindableGithubLink('not a url'), false)
})

test('maps Linear issue links to the bound workspace by org url key', () => {
  assert.equal(
    resolve('https://linear.app/zeabur/issue/NUPS-123/some-title'),
    '/teams/team-1/linear/workspaces/linear-1/issues/NUPS-123',
  )
  // www. subdomain, and case-insensitive identifiers, are equivalent.
  assert.equal(
    resolve('https://www.linear.app/zeabur/issue/nups-123/some-title'),
    '/teams/team-1/linear/workspaces/linear-1/issues/NUPS-123',
  )
  // Unbound workspace, and a linear.app page with no in-app twin.
  assert.equal(resolve('https://linear.app/other-workspace/issue/NUPS-123'), null)
  assert.equal(resolve('https://linear.app/zeabur/project/some-project'), null)
})

test('isBindableLinearLink covers the pages the resolver can host', () => {
  assert.equal(isBindableLinearLink('https://linear.app/zeabur/issue/NUPS-123/title'), true)
  assert.equal(isBindableLinearLink('https://linear.app/zeabur/project/some-project'), false)
  assert.equal(isBindableLinearLink('not a url'), false)
})
