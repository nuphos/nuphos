import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENT_SUBPAGE_SEGMENTS,
  emptyNavigation,
  githubInstallationFromId,
  githubRepositoryFromPath,
  navigationFromAppPath,
  pageLocationForNavigation,
  teamIdFromAppPath,
} from './appRoutes.ts'
import { customResourceNavigationKey } from './customResourceNavigation.ts'

import type { NavigationSnapshot } from './appRoutes.ts'
import type { Scope } from '../types.ts'

// Run with: bun run test  (node --experimental-strip-types --test)
//
// The route-table lock. `pageLocationForNavigation` (producer) and
// `navigationFromAppPath` (parser) must stay inverse over the whole vocabulary:
// for every page the app can render, produce → parse → produce is a fixed
// point. If someone adds a page to the producer without teaching the parser
// (or vice versa), this file goes red — that class of bug used to ship (e.g.
// CloudWatch Metrics links bouncing to the external browser).

const T = 'team1'

// One snapshot per route family; each asserts the exact produce→parse→produce
// fixed point. SSH terminals have dedicated degradation tests below because a
// live PTY cannot be carried in a URL.
const CASES: { name: string; nav: NavigationSnapshot }[] = [
  // -- team sections
  { name: 'new tab', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.new-tab') },
  { name: 'agent home', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.agent') },
  {
    name: 'agent session',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.agent', { agentSessionId: 'sess-1' }),
  },
  {
    name: 'agent memories',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.agent-memories'),
  },
  { name: 'agent skills', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.agent-skills') },
  {
    name: 'archived chats',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.archived-chats'),
  },
  {
    name: 'agent skill detail',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.agent-skills', {
      filter: 'deploy-k8s',
    }),
  },
  { name: 'plans', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.plans') },
  {
    name: 'plan by number',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.plans', { filter: '42' }),
  },
  { name: 'triggers', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.triggers') },
  { name: 'audit', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.audit') },
  {
    name: 'browser bookmark',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.browser', {
      browserUrl: 'https://example.com/path?q=a&next=%2Ftest#section',
    }),
  },
  { name: 'files', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.files') },
  { name: 'terminal', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.terminal') },
  { name: 'browser', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.browser') },
  { name: 'monitoring', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.monitoring') },
  { name: 'schedule', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.schedule') },
  { name: 'members', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.members') },
  { name: 'architecture', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.architecture') },
  {
    name: 'architecture diagram',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.architecture', {
      architectureDetail: { diagramId: 'diag-1', diagramName: 'Diagram' },
    }),
  },
  { name: 'dashboards', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.dashboards') },
  {
    name: 'dashboard',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.dashboards', {
      nuphosDashboard: { dashboardId: 'dash-1', dashboardName: 'Dashboard' },
    }),
  },
  {
    name: 'linear teams',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.linear', {
      linearNav: { view: 'teams' },
    }),
  },
  {
    name: 'linear team issues',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.linear', {
      linearNav: {
        view: 'team',
        bindingId: 'binding-1',
        team: { id: 'team-uuid', key: '', name: 'Team' },
      },
    }),
  },
  {
    name: 'linear issue',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.linear', {
      linearNav: { view: 'issue', bindingId: 'binding-1', identifier: 'EX-123' },
    }),
  },
  { name: 'connectors', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.integrations') },
  {
    name: 'connectors add modal',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.integrations', {
      addIntegrationOpen: true,
    }),
  },
  {
    name: 'connector detail',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.integrations', {
      connectorDetail: { provider: 'linear', connectorId: 'conn-1', name: 'Linear' },
    }),
  },
  {
    name: 'observability fallback',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.observability'),
  },

  // -- grafana
  {
    name: 'grafana dashboards',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.dashboards', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
    }),
  },
  {
    name: 'grafana dashboard detail',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.dashboards', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
      dashboardTarget: { uid: 'dash-uid', title: 'dash-uid' },
    }),
  },
  {
    name: 'grafana alerts',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.alerts', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
    }),
  },
  {
    name: 'grafana datasources',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.datasources', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
    }),
  },
  {
    name: 'grafana trace explorer',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.datasources', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
      traceDatasourceTarget: { uid: 'tempo-uid', name: 'tempo-uid', type: 'tempo' },
    }),
  },
  {
    name: 'grafana log explorer',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'observability.datasources', {
      grafanaInstance: { id: 'g1', name: 'g1', url: '' },
      logDatasourceTarget: { uid: 'loki-uid', name: 'loki-uid', type: 'loki' },
    }),
  },

  // -- repository
  { name: 'repository home', nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository') },
  {
    name: 'repository gitlab',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository', {
      repoProvider: 'gitlab',
    }),
  },
  {
    name: 'github installation repos',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository', {
      githubNav: { view: 'repos', installation: githubInstallationFromId('123') },
    }),
  },
  {
    name: 'github repo PRs',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository', {
      githubNav: {
        view: 'repo',
        installation: githubInstallationFromId('123', 'acme'),
        repo: githubRepositoryFromPath('acme', 'webapp'),
        tab: 'prs',
        prState: 'all',
      },
    }),
  },
  {
    name: 'github repo workflows',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository', {
      githubNav: {
        view: 'repo',
        installation: githubInstallationFromId('123', 'acme'),
        repo: githubRepositoryFromPath('acme', 'webapp'),
        tab: 'actions',
        prState: 'open',
      },
    }),
  },
  {
    name: 'github pull request detail',
    nav: emptyNavigation({ kind: 'team', teamId: T }, 'team.repository', {
      githubNav: {
        view: 'pull',
        installation: githubInstallationFromId('123', 'acme'),
        repo: githubRepositoryFromPath('acme', 'webapp'),
        prNumber: 42,
        prTitle: 'Pull request',
        prState: 'open',
      },
    }),
  },

  // -- connectors: account-level settings pages
  {
    name: 'aws roles',
    nav: emptyNavigation(
      { kind: 'aws-account', teamId: T, accountId: '682033483399' },
      'aws.roles',
    ),
  },
  {
    name: 'aws role detail',
    nav: emptyNavigation(
      {
        kind: 'aws-account',
        teamId: T,
        accountId: '682033483399',
        roleArn: 'arn:aws:iam::682033483399:role/nuphos',
      },
      'aws.role',
    ),
  },
  {
    name: 'gcp service accounts',
    nav: emptyNavigation(
      { kind: 'gcp-project', teamId: T, projectId: 'proj-1' },
      'gcp.service-accounts',
    ),
  },
  {
    name: 'gcp service account detail',
    nav: emptyNavigation(
      { kind: 'gcp-project', teamId: T, projectId: 'proj-1', serviceAccountId: 'sa-1' },
      'gcp.service-account',
    ),
  },
  {
    name: 'cloudflare iam',
    nav: emptyNavigation(
      { kind: 'cloudflare-account', teamId: T, accountId: 'cf-1' },
      'cloudflare.iam',
    ),
  },
  {
    name: 'azure apps',
    nav: emptyNavigation(
      { kind: 'azure-subscription', teamId: T, subscriptionId: 'sub-1' },
      'azure.apps',
    ),
  },

  // -- compliance
  {
    name: 'compliance tests',
    nav: emptyNavigation({
      kind: 'compliance-integration',
      teamId: T,
      provider: 'secureframe',
      integrationId: 'int-1',
    }),
  },

  // -- AWS infra
  ...(
    [
      'aws.vpcs',
      'aws.nacls',
      'aws.clusters',
      'aws.ec2',
      'aws.lightsail',
      'aws.ecs',
      'aws.cloudformation',
      'aws.lambda',
      'aws.cloudwatch',
      'aws.cloudwatch-alarms',
      'aws.cloudwatch-metrics',
      'aws.s3',
    ] as const
  ).map((active) => ({
    name: `aws section ${active}`,
    nav: emptyNavigation({ kind: 'aws-account' as const, teamId: T, accountId: 'a1' }, active),
  })),
  {
    name: 'aws lambda detail',
    nav: emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'a1' }, 'aws.lambda', {
      awsDetail: { kind: 'lambda', region: 'us-east-1', name: 'fn-1' },
    }),
  },
  {
    name: 'aws log group detail',
    nav: emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'a1' }, 'aws.cloudwatch', {
      awsDetail: { kind: 'logGroup', region: 'us-east-1', name: '/aws/lambda/fn-1' },
    }),
  },
  {
    name: 'aws alarm detail',
    nav: emptyNavigation(
      { kind: 'aws-account', teamId: T, accountId: 'a1' },
      'aws.cloudwatch-alarms',
      {
        awsDetail: { kind: 'alarm', region: 'eu-west-1', name: 'HighCPU' },
      },
    ),
  },
  {
    name: 'aws s3 bucket',
    nav: emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'a1' }, 'aws.s3', {
      s3Detail: { bucket: 'my-bucket', region: '', prefix: '' },
    }),
  },
  {
    name: 'aws s3 prefix',
    nav: emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'a1' }, 'aws.s3', {
      s3Detail: { bucket: 'my-bucket', region: '', prefix: 'logs/2026/' },
    }),
  },
  {
    name: 'aws ecs cluster pages',
    nav: emptyNavigation(
      {
        kind: 'aws-ecs-cluster',
        teamId: T,
        accountId: 'a1',
        region: 'us-east-1',
        clusterName: 'prod',
        clusterArn: '',
      },
      'ecs.metrics',
    ),
  },

  // -- k8s clusters (aws/gcp carry full scope in the URL)
  {
    name: 'eks cluster pods',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aws-account',
        parentId: 'a1',
        clusterName: 'prod',
        provider: 'aws',
        region: 'us-east-1',
      },
      'workloads.pods',
    ),
  },
  {
    name: 'on-prem cluster pods',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'onprem-cluster',
        parentId: '507f1f77bcf86cd799439011',
        clusterName: 'acme-dc1',
        provider: 'onprem',
        region: 'onprem',
        onpremClusterId: '507f1f77bcf86cd799439011',
      },
      'workloads.pods',
    ),
  },
  {
    name: 'custom resource with grouped API version',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aws-account',
        parentId: 'a1',
        clusterName: 'prod',
        provider: 'aws',
        region: 'us-east-1',
      },
      customResourceNavigationKey({
        apiVersion: 'cert-manager.io/v1',
        kind: 'Certificate',
        plural: 'certificates',
        namespaced: true,
      }),
    ),
  },
  {
    name: 'eks cluster nodes',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aws-account',
        parentId: 'a1',
        clusterName: 'prod',
        provider: 'aws',
        region: 'us-east-1',
      },
      'cluster.nodes',
    ),
  },
  {
    name: 'gke cluster with namespace + resource',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'gcp-project',
        parentId: 'proj-1',
        clusterName: 'prod',
        provider: 'gcp',
        region: 'us-central1',
        namespace: 'default',
      },
      'workloads.deployments',
      { target: { kind: 'Deployment', namespace: 'default', name: 'api' } },
    ),
  },
  {
    name: 'cluster-scoped resource (no namespace)',
    nav: emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aws-account',
        parentId: 'a1',
        clusterName: 'prod',
        provider: 'aws',
        region: 'us-east-1',
      },
      'storage.storage-classes',
      { target: { kind: 'StorageClass', namespace: null, name: 'gp2' } },
    ),
  },

  // -- GCP infra
  ...(
    [
      'gcp.vpcs',
      'gcp.firewalls',
      'gcp.clusters',
      'gcp.gce',
      'gcp.cloudrun',
      'gcp.metrics',
      'gcp.dashboards',
    ] as const
  ).map((active) => ({
    name: `gcp section ${active}`,
    nav: emptyNavigation({ kind: 'gcp-project' as const, teamId: T, projectId: 'proj-1' }, active),
  })),

  // -- Cloudflare infra
  ...(
    [
      'cloudflare.zones',
      'cloudflare.workers',
      'cloudflare.r2',
      'cloudflare.pages',
      'cloudflare.d1',
      'cloudflare.kv',
    ] as const
  ).map((active) => ({
    name: `cloudflare section ${active}`,
    nav: emptyNavigation(
      { kind: 'cloudflare-account' as const, teamId: T, accountId: 'cf-1' },
      active,
    ),
  })),
  {
    name: 'cloudflare zone dns',
    nav: emptyNavigation({
      kind: 'cloudflare-zone',
      teamId: T,
      accountId: 'cf-1',
      zoneId: 'zone-1',
      zoneName: 'zone-1',
    }),
  },
  {
    name: 'cloudflare worker detail',
    nav: emptyNavigation(
      { kind: 'cloudflare-account', teamId: T, accountId: 'cf-1' },
      'cloudflare.workers',
      {
        cloudflareDetail: { kind: 'worker', name: 'my-worker' },
      },
    ),
  },
  {
    name: 'cloudflare r2 prefix',
    nav: emptyNavigation(
      { kind: 'cloudflare-account', teamId: T, accountId: 'cf-1' },
      'cloudflare.r2',
      {
        cloudflareDetail: { kind: 'r2', name: 'bucket', prefix: 'media/img/' },
      },
    ),
  },
  {
    name: 'cloudflare d1 detail',
    nav: emptyNavigation(
      { kind: 'cloudflare-account', teamId: T, accountId: 'cf-1' },
      'cloudflare.d1',
      {
        cloudflareDetail: { kind: 'd1', name: 'db-id', id: 'db-id' },
      },
    ),
  },

  // -- simple providers
  {
    name: 'linode instances',
    nav: emptyNavigation(
      { kind: 'linode-account', teamId: T, accountId: 'l1' },
      'linode.instances',
    ),
  },
  {
    name: 'linode lke',
    nav: emptyNavigation({ kind: 'linode-account', teamId: T, accountId: 'l1' }, 'linode.lke'),
  },
  {
    name: 'hetzner servers',
    nav: emptyNavigation(
      { kind: 'hetzner-account', teamId: T, accountId: 'h1' },
      'hetzner.servers',
    ),
  },
  {
    name: 'tencent cvm',
    nav: emptyNavigation({ kind: 'tencent-account', teamId: T, accountId: 't1' }, 'tencent.cvm'),
  },
  {
    name: 'tencent clusters',
    nav: emptyNavigation(
      { kind: 'tencent-account', teamId: T, accountId: 't1' },
      'tencent.clusters',
    ),
  },
  {
    name: 'aliyun ecs',
    nav: emptyNavigation({ kind: 'aliyun-account', teamId: T, accountId: 'al1' }, 'aliyun.ecs'),
  },
  {
    name: 'aliyun swas',
    nav: emptyNavigation({ kind: 'aliyun-account', teamId: T, accountId: 'al1' }, 'aliyun.swas'),
  },
  {
    name: 'aliyun clusters',
    nav: emptyNavigation(
      { kind: 'aliyun-account', teamId: T, accountId: 'al1' },
      'aliyun.clusters',
    ),
  },
  {
    name: 'volcengine ecs',
    nav: emptyNavigation(
      { kind: 'volcengine-account', teamId: T, accountId: 'v1' },
      'volcengine.ecs',
    ),
  },
  {
    name: 'volcengine clusters',
    nav: emptyNavigation(
      { kind: 'volcengine-account', teamId: T, accountId: 'v1' },
      'volcengine.clusters',
    ),
  },
  ...(
    [
      'betterstack.monitors',
      'betterstack.incidents',
      'betterstack.sources',
      'betterstack.dashboards',
    ] as const
  ).map((active) => ({
    name: `betterstack ${active}`,
    nav: emptyNavigation(
      { kind: 'betterstack-integration' as const, teamId: T, integrationId: 'b1' },
      active,
    ),
  })),
  {
    name: 'uptime-kuma monitors',
    nav: emptyNavigation({ kind: 'uptime-kuma-instance', teamId: T, instanceId: 'u1' }),
  },
  ...[
    'database.overview',
    'database.collections',
    'database.query',
    'database.changes',
    'database.monitoring',
    'database.access',
    'database.audit',
    'database.settings',
  ].map((active) => ({
    name: `database ${active}`,
    nav: emptyNavigation({ kind: 'database-connection', teamId: T, connectionId: 'db1' }, active),
  })),
  {
    name: 'tailscale devices',
    nav: emptyNavigation({ kind: 'tailscale-client', teamId: T, clientId: 'ts1' }),
  },
  {
    name: 'zeabur projects',
    nav: emptyNavigation({ kind: 'zeabur-provider', teamId: T, zeaburId: 'z1' }, 'zeabur.projects'),
  },
  {
    name: 'zeabur servers',
    nav: emptyNavigation({ kind: 'zeabur-provider', teamId: T, zeaburId: 'z1' }, 'zeabur.servers'),
  },
]

// The Chats page merged into Agent, which carries the conversation list beside
// the chat. Its paths keep resolving so shared links and older clients still
// land somewhere right; the producer no longer emits them.
test('legacy /chats paths resolve to the Agent page', () => {
  const list = navigationFromAppPath(`/teams/${T}/chats`)

  assert.equal(list?.active, 'team.agent')
  assert.equal(list?.agentSessionId, null)

  const reading = navigationFromAppPath(`/teams/${T}/chats/sess-1`)

  assert.equal(reading?.active, 'team.agent')
  assert.equal(reading?.agentSessionId, 'sess-1')
  assert.equal(pageLocationForNavigation(reading!).href, `/teams/${T}/agent/sess-1`)
})

test('route table round-trips: produce → parse → produce is a fixed point', () => {
  for (const { name, nav } of CASES) {
    const location = pageLocationForNavigation(nav)
    const parsed = navigationFromAppPath(location.href)

    assert.ok(parsed, `${name}: parser returned null for ${location.href}`)
    const reproduced = pageLocationForNavigation(parsed)

    assert.equal(
      reproduced.href,
      location.href,
      `${name}: ${location.href} parsed to a navigation that produces ${reproduced.href}`,
    )
  }
})

test('custom resource detail routes preserve the CRD identity', () => {
  const nav = emptyNavigation(
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aws-account',
      parentId: 'a1',
      clusterName: 'prod',
      provider: 'aws',
      region: 'us-east-1',
    },
    customResourceNavigationKey({
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      plural: 'certificates',
      namespaced: true,
    }),
    {
      target: {
        kind: 'CustomResource',
        namespace: 'default',
        name: 'site-certificate',
        apiVersion: 'cert-manager.io/v1',
        resourceKind: 'Certificate',
        plural: 'certificates',
      },
    },
  )

  const parsed = navigationFromAppPath(pageLocationForNavigation(nav).href)

  assert.deepEqual(parsed?.target, nav.target)
})

test('aggregate custom resource detail routes preserve the CRD identity', () => {
  const nav = emptyNavigation(
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aws-account',
      parentId: 'a1',
      clusterName: 'prod',
      provider: 'aws',
      region: 'us-east-1',
    },
    'custom.resources',
    {
      target: {
        kind: 'CustomResource',
        namespace: 'default',
        name: 'site-certificate',
        apiVersion: 'cert-manager.io/v1',
        resourceKind: 'Certificate',
        plural: 'certificates',
      },
    },
  )

  const location = pageLocationForNavigation(nav)
  const parsed = navigationFromAppPath(location.href)

  assert.match(
    location.pathname,
    /\/custom-resources\/cert-manager\.io\/v1\/Certificate\/certificates\/namespaced\//,
  )
  assert.deepEqual(parsed?.target, nav.target)
  assert.equal(pageLocationForNavigation(parsed!).href, location.href)
})

test('custom resource detail routes tolerate a plural named resources', () => {
  const active = customResourceNavigationKey({
    apiVersion: 'example.io/v1',
    kind: 'Resource',
    plural: 'resources',
    namespaced: true,
  })
  const nav = emptyNavigation(
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aws-account',
      parentId: 'a1',
      clusterName: 'prod',
      provider: 'aws',
      region: 'us-east-1',
    },
    active,
    {
      target: {
        kind: 'CustomResource',
        namespace: 'default',
        name: 'example',
        apiVersion: 'example.io/v1',
        resourceKind: 'Resource',
        plural: 'resources',
      },
    },
  )

  const parsed = navigationFromAppPath(pageLocationForNavigation(nav).href)

  assert.equal(parsed?.active, active)
  assert.deepEqual(parsed?.target, nav.target)
})

test('Kubernetes routes preserve the selected cloud credential', () => {
  const navs: NavigationSnapshot[] = [
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aws-account',
        parentId: 'a1',
        roleId: 'role-2',
        clusterName: 'prod',
        provider: 'aws',
        region: 'us-east-1',
      },
      'workloads.pods',
    ),
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'gcp-project',
        parentId: 'project-1',
        serviceAccountId: 'service-account-2',
        clusterName: 'prod',
        provider: 'gcp',
        region: 'us-central1',
      },
      'workloads.pods',
    ),
  ]

  for (const nav of navs) {
    const location = pageLocationForNavigation(nav)

    assert.match(location.search, /credential=/)
    assert.deepEqual(navigationFromAppPath(location.href)?.scope, nav.scope)
  }
})

test('malformed custom resource navigation does not throw while serializing', () => {
  const nav = emptyNavigation(
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aws-account',
      parentId: 'a1',
      clusterName: 'prod',
      provider: 'aws',
      region: 'us-east-1',
    },
    customResourceNavigationKey({
      apiVersion: 'v1',
      kind: 'Thing',
      plural: 'things',
      namespaced: true,
    }),
  )

  assert.doesNotThrow(() => pageLocationForNavigation(nav))
})

test('custom resource routes restore every provider cluster scope', () => {
  const active = customResourceNavigationKey({
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    plural: 'certificates',
    namespaced: true,
  })
  const navs: NavigationSnapshot[] = [
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'linode-account',
        parentId: 'linode-1',
        clusterName: 'prod',
        provider: 'linode',
        region: 'us-east',
        linodeClusterId: 42,
      },
      active,
    ),
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'tencent-account',
        parentId: 'tencent-1',
        clusterName: 'prod',
        provider: 'tencent',
        region: 'ap-guangzhou',
        tencentClusterId: 'cls-123',
      },
      active,
    ),
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'aliyun-account',
        parentId: 'aliyun-1',
        clusterName: 'prod',
        provider: 'aliyun',
        region: 'cn-hangzhou',
        aliyunClusterId: 'c123',
      },
      active,
    ),
    emptyNavigation(
      {
        kind: 'cluster',
        teamId: T,
        parentKind: 'volcengine-account',
        parentId: 'volcengine-1',
        clusterName: 'prod',
        provider: 'volcengine',
        region: 'cn-beijing',
        volcengineClusterId: 'cc123',
      },
      active,
    ),
  ]

  for (const nav of navs) {
    const location = pageLocationForNavigation(nav)

    assert.match(
      location.pathname,
      /\/k8s\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/custom-resources\/cert-manager\.io\/v1\/Certificate\/certificates\/namespaced$/,
    )
    const parsed = navigationFromAppPath(location.href)

    assert.equal(parsed?.scope.kind, 'cluster')
    assert.equal(parsed?.active, active)
    assert.equal(pageLocationForNavigation(parsed!).href, location.href)
  }
})

// A pinned favourite (and any shared link) is stored as a produced path and
// reopened by parsing it back, so the page a cluster URL was captured on has to
// survive the round trip for every provider — see the `cluster` mention carve-out
// in openNuphosLinkInNewTab, which exists for exactly this.
test('cluster page paths round-trip their page for every provider', () => {
  const clusterScopes: Extract<Scope, { kind: 'cluster' }>[] = [
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aws-account',
      parentId: 'a1',
      clusterName: 'prod',
      provider: 'aws',
      region: 'us-east-1',
    },
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'gcp-project',
      parentId: 'p1',
      clusterName: 'prod',
      provider: 'gcp',
      region: 'us-central1',
    },
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'linode-account',
      parentId: 'l1',
      clusterName: 'prod',
      provider: 'linode',
      region: 'us-east',
      linodeClusterId: 42,
    },
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'tencent-account',
      parentId: 't1',
      clusterName: 'prod',
      provider: 'tencent',
      region: 'ap-guangzhou',
      tencentClusterId: 'cls-123',
    },
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'aliyun-account',
      parentId: 'al1',
      clusterName: 'prod',
      provider: 'aliyun',
      region: 'cn-hangzhou',
      aliyunClusterId: 'c123',
    },
    {
      kind: 'cluster',
      teamId: T,
      parentKind: 'volcengine-account',
      parentId: 'v1',
      clusterName: 'prod',
      provider: 'volcengine',
      region: 'cn-beijing',
      volcengineClusterId: 'cc123',
    },
  ]
  const pages = [
    'cluster.overview',
    'workloads.deployments',
    'network.services',
    'custom.resources',
  ]

  for (const scope of clusterScopes) {
    for (const active of pages) {
      const { href } = pageLocationForNavigation(emptyNavigation(scope, active))
      const parsed = navigationFromAppPath(href)

      assert.ok(parsed, href)
      assert.equal(parsed.active, active, href)
      assert.equal(pageLocationForNavigation(parsed).href, href)
    }
  }
})

test('every produced path stays inside /teams/<teamId>', () => {
  for (const { name, nav } of CASES) {
    const { href } = pageLocationForNavigation(nav)

    assert.equal(teamIdFromAppPath(href), T, `${name}: ${href}`)
  }
})

// SSH-terminal paths can't restore a PTY from a URL — they land on the
// pre-filtered instances list instead of failing (or worse, the browser).
test('ssh terminal paths degrade to the instances list', () => {
  const awsNav = emptyNavigation({ kind: 'aws-account', teamId: T, accountId: 'a1' }, 'aws.ec2')
  const sshLocation = pageLocationForNavigation(awsNav, {
    sshTerminal: { region: 'us-east-1', instanceName: 'web-1' },
  })

  assert.equal(sshLocation.href, `/teams/${T}/infra/aws/a1/ec2/us-east-1/instances/web-1/ssh`)
  const parsed = navigationFromAppPath(sshLocation.href)

  assert.ok(parsed)
  assert.equal(parsed.active, 'aws.ec2')
  assert.equal(parsed.filter, 'web-1')

  const gceHref = `/teams/${T}/infra/gcp/proj-1/gce/us-central1/instances/vm-1/ssh`
  const gceParsed = navigationFromAppPath(gceHref)

  assert.ok(gceParsed)
  assert.equal(gceParsed.active, 'gcp.gce')
  assert.equal(gceParsed.filter, 'vm-1')
})

// Pre-/k8s/ cluster drill-down URLs carry a cluster name where the canonical
// route needs a provider cluster id, so they land on the clusters list.
test('legacy provider cluster drill-downs degrade to the clusters list', () => {
  const cases: [string, string][] = [
    [`/teams/${T}/infra/linode/l1/clusters/us-east/prod`, 'linode.lke'],
    [`/teams/${T}/infra/tencent/t1/clusters/ap-guangzhou/prod`, 'tencent.clusters'],
    [`/teams/${T}/infra/aliyun/al1/clusters/cn-hangzhou/prod`, 'aliyun.clusters'],
    [`/teams/${T}/infra/volcengine/v1/clusters/cn-beijing/prod`, 'volcengine.clusters'],
  ]

  for (const [href, active] of cases) {
    const parsed = navigationFromAppPath(href)

    assert.ok(parsed, href)
    assert.equal(parsed.active, active, href)
  }
})

// Legacy inbound aliases must keep resolving: pre-rename provider segments
// (the old doubled `<provider>/<page>` paths) and the old /settings routes.
test('legacy aliases parse to the same navigation as their canonical form', () => {
  const aliases: [string, string][] = [
    [`/teams/${T}/infra/linode/l1/linode/instances`, `/teams/${T}/infra/linode/l1/instances`],
    [`/teams/${T}/infra/linode/l1/linode/lke`, `/teams/${T}/infra/linode/l1/lke-clusters`],
    [`/teams/${T}/infra/hetzner/h1/hetzner/servers`, `/teams/${T}/infra/hetzner/h1/servers`],
    [`/teams/${T}/infra/tencent/t1/tencent/clusters`, `/teams/${T}/infra/tencent/t1/tke-clusters`],
    [`/teams/${T}/infra/aliyun/al1/aliyun/clusters`, `/teams/${T}/infra/aliyun/al1/ack-clusters`],
    [
      `/teams/${T}/infra/volcengine/v1/volcengine/clusters`,
      `/teams/${T}/infra/volcengine/v1/vke-clusters`,
    ],
    [
      `/teams/${T}/infra/tailscale/ts1/tailscale/devices`,
      `/teams/${T}/infra/tailscale/ts1/devices`,
    ],
    [`/teams/${T}/settings`, `/teams/${T}/connectors`],
    [`/teams/${T}/cost-management`, `/teams/${T}/dashboards`],
    [`/teams/${T}/cost-management/dash-1`, `/teams/${T}/dashboards/dash-1`],
    [
      `/teams/${T}/settings/integrations/682033483399/roles`,
      `/teams/${T}/connectors/682033483399/roles`,
    ],
  ]

  for (const [legacy, canonical] of aliases) {
    const parsedLegacy = navigationFromAppPath(legacy)
    const parsedCanonical = navigationFromAppPath(canonical)

    assert.ok(parsedLegacy, legacy)
    assert.ok(parsedCanonical, canonical)
    assert.deepEqual(parsedLegacy, parsedCanonical, legacy)
  }
})

// Full nuphos.ai URLs (what chat links and deep links actually carry) parse
// the same as bare paths, including query strings.
test('parser accepts absolute URLs and query params', () => {
  const parsed = navigationFromAppPath(
    'https://nuphos.ai/teams/6a6198d06a7585a89e02775d/infra/aws/682033483399/cloudwatch-metrics',
  )

  assert.ok(parsed)
  assert.equal(parsed.active, 'aws.cloudwatch-metrics')
  assert.deepEqual(parsed.scope, {
    kind: 'aws-account',
    teamId: '6a6198d06a7585a89e02775d',
    accountId: '682033483399',
  })

  const withNs = navigationFromAppPath(
    `/teams/${T}/k8s/aws/a1/us-east-1/prod/workloads/pods?namespace=kube-system`,
  )

  assert.ok(withNs)
  assert.equal(withNs.scope.kind, 'cluster')
  assert.equal((withNs.scope as { namespace?: string }).namespace, 'kube-system')
})

test('a pull request path without a state backs out to the list that can show it', () => {
  const repo = `/teams/${T}/repository/installations/123/repos/acme/webapp`
  const pull = navigationFromAppPath(`${repo}/pull-requests/42`)
  const list = navigationFromAppPath(`${repo}/pull-requests`)

  assert.equal(pull?.githubNav.view === 'pull' && pull.githubNav.prState, 'all')
  assert.equal(list?.githubNav.view === 'repo' && list.githubNav.prState, 'open')
})

test('non-app paths return null', () => {
  assert.equal(navigationFromAppPath('/login'), null)
  assert.equal(navigationFromAppPath('https://docs.nuphos.ai/teams/x'), null)
  assert.equal(navigationFromAppPath('not a url //'), null)
  // Malformed percent-encoding survives URL parsing; must not throw URIError.
  assert.equal(navigationFromAppPath('/teams/%E0%A4%A/plans'), null)
  assert.equal(teamIdFromAppPath('/teams/%E0%A4%A'), null)
})

// The mention parser in `atlasLinkMention` sees a link before this route table
// does, and it reads /teams/T/agent/<seg> as an agent session unless <seg> is
// in AGENT_SUBPAGE_SEGMENTS. So every /agent/<page> the producer can emit must
// be listed there, or that page's deep links silently land on the Agent page
// (which is exactly what happened to Skills).
test('every /agent/<page> route is declared as a subpage, not a session id', () => {
  const scope: NavigationSnapshot['scope'] = { kind: 'team', teamId: T }
  const agentSubpageKeys = ['team.agent-memories', 'team.agent-skills', 'team.archived-chats']

  for (const key of agentSubpageKeys) {
    const href = pageLocationForNavigation(emptyNavigation(scope, key)).href
    const segs = href.split('?')[0].split('/').filter(Boolean)

    assert.equal(segs[2], 'agent', `${key} → ${href}`)
    assert.ok(segs[3], `${key} → ${href} has no page segment`)
    assert.ok(
      AGENT_SUBPAGE_SEGMENTS.has(segs[3]),
      `${key} produces /agent/${segs[3]} but "${segs[3]}" is missing from AGENT_SUBPAGE_SEGMENTS`,
    )
    // And it must still parse back to the page, not to a session.
    const parsed = navigationFromAppPath(href)

    assert.equal(parsed?.active, key)
    assert.equal(parsed?.agentSessionId, null)
  }

  // A real session id must NOT be treated as a page.
  assert.ok(!AGENT_SUBPAGE_SEGMENTS.has('6a6198d06a7585a89e02775d'))
})

test('Kubernetes route parser rejects inherited object keys as providers', () => {
  assert.equal(
    navigationFromAppPath(`/teams/${T}/k8s/toString/account/region/cluster/workloads/pods`),
    null,
  )
})
