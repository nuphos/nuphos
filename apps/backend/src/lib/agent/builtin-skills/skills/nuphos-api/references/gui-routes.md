# Nuphos GUI route catalog

Canonical host: `https://nuphos.ai`

Use this file with `rg`/`grep` when you need to add a Nuphos GUI markdown link to an answer without loading the full catalog into context.

Suggested searches:

```bash
rg -i "s3|bucket" apps/backend/src/lib/agent/builtin-skills/skills/nuphos-api/references/gui-routes.md
rg -i "ec2|instance" apps/backend/src/lib/agent/builtin-skills/skills/nuphos-api/references/gui-routes.md
rg -i "grafana|dashboard|datasource|alert" apps/backend/src/lib/agent/builtin-skills/skills/nuphos-api/references/gui-routes.md
rg -i "k8s|pod|deployment|service|secret" apps/backend/src/lib/agent/builtin-skills/skills/nuphos-api/references/gui-routes.md
```

Format:

`route_id | keywords | required ids | URL template | link text`

Only create a link when you have all required ids. Use the exact displayed resource name/id as the markdown link text. Do not guess missing ids.

## Team, Agent, Settings

team.agent | agent chat conversation session | teamId | `https://nuphos.ai/teams/<teamId>/agent` | Agent
team.agent.session | agent chat conversation session | teamId, sessionId | `https://nuphos.ai/teams/<teamId>/agent/<sessionId>` | session title or sessionId
team.agent.memories | agent memories memory | teamId | `https://nuphos.ai/teams/<teamId>/agent/memories` | Memories
team.plans | plans plan list | teamId | `https://nuphos.ai/teams/<teamId>/plans` | Plans
team.plan | plan approval execution | teamId, planId | `https://nuphos.ai/teams/<teamId>/plans/<planId>` | plan title or planId
team.integrations | integrations accounts providers | teamId | `https://nuphos.ai/teams/<teamId>/settings/integrations` | Integrations
team.members | members users team settings | teamId | `https://nuphos.ai/teams/<teamId>/settings/members` | Members
team.handoff | handoff settings | teamId | `https://nuphos.ai/teams/<teamId>/settings/handoff` | Handoff

## Observability and Grafana

observability.home | observability grafana list | teamId | `https://nuphos.ai/teams/<teamId>/observability` | Observability
grafana.dashboards | grafana dashboards | teamId, instanceId | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/dashboards` | Dashboards
grafana.dashboard | grafana dashboard | teamId, instanceId, uid | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/dashboards/<uid>` | dashboard title or uid
grafana.datasources | grafana datasources | teamId, instanceId | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/datasources` | Datasources
grafana.datasource | grafana datasource | teamId, instanceId, uid | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/datasources/<uid>` | datasource name or uid
grafana.traceExplorer | grafana tempo trace explorer datasource | teamId, instanceId, uid | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/datasources/<uid>/trace-explorer` | trace datasource name or uid
grafana.alerts | grafana alerts rules | teamId, instanceId | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/alerts` | Alerts
grafana.alert | grafana alert rule | teamId, instanceId, uid | `https://nuphos.ai/teams/<teamId>/observability/grafana/<instanceId>/alerts/<uid>` | alert name or uid

## GitHub

github.repositoryHome | github repository installations | teamId | `https://nuphos.ai/teams/<teamId>/repository` | Repository
github.installation | github installation repositories repos | teamId, installationId | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>` | installation name or installationId
github.repo.prs | github repo pull requests prs | teamId, installationId, owner, repo | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/pull-requests` | repo name
github.repo.prs.state | github repo pull requests prs state open closed all | teamId, installationId, owner, repo, state | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/pull-requests?state=<state>` | repo name
github.repo.workflows | github repo workflows actions runs | teamId, installationId, owner, repo | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/workflows` | repo name
github.pullRequest | github pull request pr | teamId, installationId, owner, repo, number | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/pull-requests/<number>` | PR title or #number
github.workflowRun | github workflow run action | teamId, installationId, owner, repo, runId | `https://nuphos.ai/teams/<teamId>/repository/installations/<installationId>/repos/<owner>/<repo>/workflows/<runId>` | workflow name or runId

## GitLab

gitlab.repositoryHome | gitlab projects merge requests pipelines | teamId | `https://nuphos.ai/teams/<teamId>/repository/gitlab` | GitLab

## AWS

aws.account | aws account | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>` | account label or accountId
aws.vpcs | aws vpc list network | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/vpcs` | VPCs
aws.vpc | aws vpc network | teamId, accountId, vpcId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/vpcs/<vpcId>` | vpcId
aws.networkAcls | aws nacl network acl list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/network-acls` | Network ACLs
aws.networkAcl | aws nacl network acl | teamId, accountId, naclId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/network-acls/<naclId>` | naclId
aws.eksClusters | aws eks cluster list kubernetes | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/eks-clusters` | EKS clusters
aws.eksCluster | aws eks cluster kubernetes | teamId, accountId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/clusters/<region>/<clusterName>` | clusterName
aws.ecsClusters | aws ecs cluster list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters` | ECS clusters
aws.ecsServices | aws ecs cluster services | teamId, accountId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters/<region>/<clusterName>/services` | clusterName
aws.ecsTasks | aws ecs cluster tasks | teamId, accountId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters/<region>/<clusterName>/tasks` | clusterName
aws.ecsInfrastructure | aws ecs cluster infrastructure container instances | teamId, accountId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters/<region>/<clusterName>/infrastructure` | clusterName
aws.ecsMetrics | aws ecs cluster metrics | teamId, accountId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ecs-clusters/<region>/<clusterName>/metrics` | clusterName
aws.ec2Instances | aws ec2 instance list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ec2-instances` | EC2 instances
aws.ec2Instance | aws ec2 instance | teamId, accountId, instanceId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ec2-instances/<instanceId>` | instance name or instanceId
aws.ec2Ssh | aws ec2 ssh instance terminal | teamId, accountId, region, instanceName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/ec2/<region>/instances/<instanceName>/ssh` | instanceName
aws.lightsailInstances | aws lightsail instance list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/lightsail` | Lightsail
aws.lightsailInstance | aws lightsail instance | teamId, accountId, region, instanceName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/lightsail/<region>/instances/<instanceName>` | instanceName
aws.lightsailSsh | aws lightsail ssh instance terminal | teamId, accountId, region, instanceName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/lightsail/<region>/instances/<instanceName>/ssh` | instanceName
aws.cloudFormationStacks | aws cloudformation cfn stack list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/cloudformation` | CloudFormation
aws.cloudFormationStack | aws cloudformation cfn stack | teamId, accountId, region, stackName | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/cloudformation/<region>/<stackName>` | stackName
aws.s3Buckets | aws s3 bucket list storage | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/s3-buckets` | S3 buckets
aws.s3Bucket | aws s3 bucket storage | teamId, accountId, bucket | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/s3-buckets/<bucket>` | bucket
aws.s3Path | aws s3 bucket prefix object key storage | teamId, accountId, bucket, prefixOrKey | `https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/s3-buckets/<bucket>/<prefixOrKey>` | bucket/prefix/key
aws.iamRoles | aws iam role roles | teamId, accountId | `https://nuphos.ai/teams/<teamId>/settings/integrations/<accountId>/roles` | Roles
aws.iamRole | aws iam role | teamId, accountId, roleIdOrArn | `https://nuphos.ai/teams/<teamId>/settings/integrations/<accountId>/roles/<roleIdOrArn>` | role name or role ARN

## GCP

gcp.project | gcp project | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>` | projectId
gcp.vpcs | gcp vpc network list | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/vpcs` | VPC networks
gcp.vpc | gcp vpc network | teamId, projectId, vpcId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/vpcs/<vpcId>` | vpcId
gcp.firewalls | gcp firewall list | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/firewalls` | Firewalls
gcp.firewall | gcp firewall | teamId, projectId, firewallName | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/firewalls/<firewallName>` | firewallName
gcp.gkeClusters | gcp gke cluster list kubernetes | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/gke-clusters` | GKE clusters
gcp.gkeCluster | gcp gke cluster kubernetes | teamId, projectId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/clusters/<region>/<clusterName>` | clusterName
gcp.gceInstances | gcp gce compute engine instance list | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/gce-instances` | Compute Engine
gcp.gceSsh | gcp gce compute ssh instance terminal | teamId, projectId, region, instanceName | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/gce/<region>/instances/<instanceName>/ssh` | instanceName
gcp.cloudRun | gcp cloud run service serverless | teamId, projectId | `https://nuphos.ai/teams/<teamId>/infra/gcp/<projectId>/cloud-run` | Cloud Run
gcp.serviceAccounts | gcp service account iam | teamId, projectId | `https://nuphos.ai/teams/<teamId>/settings/integrations/<projectId>/service-accounts` | Service accounts
gcp.serviceAccount | gcp service account iam | teamId, projectId, serviceAccountId | `https://nuphos.ai/teams/<teamId>/settings/integrations/<projectId>/service-accounts/<serviceAccountId>` | service account email or id

## Cloudflare

cloudflare.account | cloudflare account | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/cloudflare/<accountId>` | account label or accountId
cloudflare.zones | cloudflare zones domains list | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/cloudflare/<accountId>/zones` | Domains
cloudflare.zone | cloudflare zone domain | teamId, accountId, zoneId | `https://nuphos.ai/teams/<teamId>/infra/cloudflare/<accountId>/zones/<zoneId>` | zone name or zoneId
cloudflare.iam | cloudflare iam permissions | teamId, accountId | `https://nuphos.ai/teams/<teamId>/settings/integrations/<accountId>/iam` | IAM settings
cloudflare.dnsRecords | cloudflare dns record records list | teamId, accountId, zoneId | `https://nuphos.ai/teams/<teamId>/infra/cloudflare/<accountId>/zones/<zoneId>/dns-records` | DNS records
cloudflare.dnsRecord | cloudflare dns record | teamId, accountId, zoneId, recordId | `https://nuphos.ai/teams/<teamId>/infra/cloudflare/<accountId>/zones/<zoneId>/dns-records/<recordId>` | record name or recordId

## Other providers

linode.instances | linode akamai instance instances | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/linode/<accountId>/instances` | Linodes
linode.lkeClusters | linode akamai lke kubernetes cluster clusters | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/linode/<accountId>/lke` | LKE clusters
hetzner.servers | hetzner cloud server servers | teamId, accountId | `https://nuphos.ai/teams/<teamId>/infra/hetzner/<accountId>/servers` | Servers
betterstack.monitors | betterstack uptime monitor monitors | teamId, integrationId | `https://nuphos.ai/teams/<teamId>/infra/betterstack/<integrationId>/monitors` | Monitors
betterstack.incidents | betterstack incident incidents | teamId, integrationId | `https://nuphos.ai/teams/<teamId>/infra/betterstack/<integrationId>/incidents` | Incidents
betterstack.sources | betterstack telemetry source sources logs | teamId, integrationId | `https://nuphos.ai/teams/<teamId>/infra/betterstack/<integrationId>/sources` | Sources
betterstack.dashboards | betterstack dashboard dashboards | teamId, integrationId | `https://nuphos.ai/teams/<teamId>/infra/betterstack/<integrationId>/dashboards` | Dashboards
tailscale.devices | tailscale device devices | teamId, clientId | `https://nuphos.ai/teams/<teamId>/infra/tailscale/<clientId>/devices` | Devices
zeabur.projects | zeabur project projects | teamId, zeaburId | `https://nuphos.ai/teams/<teamId>/infra/zeabur/<zeaburId>/projects` | Projects
zeabur.servers | zeabur server servers | teamId, zeaburId | `https://nuphos.ai/teams/<teamId>/infra/zeabur/<zeaburId>/servers` | Servers

## Kubernetes cluster pages

k8s.cluster.base | k8s kubernetes cluster base aws gcp linode | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>` | clusterName
k8s.cluster.overview | k8s kubernetes cluster overview | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/overview` | clusterName
k8s.cluster.events | k8s kubernetes events | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/events` | Events
k8s.cluster.nodes | k8s kubernetes nodes | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/nodes` | Nodes
k8s.helm.releases | k8s kubernetes helm releases | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/helm/releases` | Helm releases
k8s.workloads.pods | k8s kubernetes pods | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/pods` | Pods
k8s.workloads.deployments | k8s kubernetes deployments | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/deployments` | Deployments
k8s.workloads.replicasets | k8s kubernetes replicasets replica sets | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/replicasets` | ReplicaSets
k8s.workloads.statefulsets | k8s kubernetes statefulsets | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/statefulsets` | StatefulSets
k8s.workloads.daemonsets | k8s kubernetes daemonsets | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/daemonsets` | DaemonSets
k8s.workloads.jobs | k8s kubernetes jobs | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/jobs` | Jobs
k8s.workloads.cronjobs | k8s kubernetes cronjobs | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/workloads/cronjobs` | CronJobs
k8s.networking.services | k8s kubernetes services | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/networking/services` | Services
k8s.networking.ingresses | k8s kubernetes ingresses ingress | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/networking/ingresses` | Ingresses
k8s.networking.endpointSlices | k8s kubernetes endpoint slices endpointslices | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/networking/endpoint-slices` | Endpoint Slices
k8s.networking.networkPolicies | k8s kubernetes network policies networkpolicies | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/networking/network-policies` | Network Policies
k8s.access.serviceAccounts | k8s kubernetes service accounts serviceaccounts | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/access/service-accounts` | Service Accounts
k8s.access.roles | k8s kubernetes roles | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/access/roles` | Roles
k8s.access.roleBindings | k8s kubernetes role bindings rolebindings | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/access/role-bindings` | Role Bindings
k8s.access.clusterRoles | k8s kubernetes cluster roles clusterroles | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/access/cluster-roles` | Cluster Roles
k8s.access.clusterRoleBindings | k8s kubernetes cluster role bindings clusterrolebindings | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/access/cluster-role-bindings` | Cluster Role Bindings
k8s.config.configmaps | k8s kubernetes configmaps | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/config/configmaps` | ConfigMaps
k8s.config.secrets | k8s kubernetes secrets | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/config/secrets` | Secrets
k8s.storage.storageClasses | k8s kubernetes storage classes storageclasses | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/storage/storage-classes` | Storage Classes
k8s.storage.persistentVolumes | k8s kubernetes persistent volumes pv persistentvolumes | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/storage/persistent-volumes` | Persistent Volumes
k8s.storage.persistentVolumeClaims | k8s kubernetes persistent volume claims pvc persistentvolumeclaims | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/storage/persistent-volume-claims` | PVCs
k8s.custom.crds | k8s kubernetes custom resource definitions crd crds | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/custom/crds` | CRDs
k8s.custom.resources | k8s kubernetes custom resources cr | teamId, provider, parentId, region, clusterName | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/custom/resources` | Custom Resources

## Kubernetes resource details

k8s.resource.clusterScoped | k8s kubernetes resource detail node clusterrole clusterrolebinding persistentvolume storageclass crd | teamId, provider, parentId, region, clusterName, page, kindLower, name | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/<page>/resources/<kindLower>/<name>` | resource name
k8s.resource.namespaced | k8s kubernetes resource detail pod deployment service ingress secret configmap job cronjob statefulset daemonset role rolebinding serviceaccount networkpolicy endpointslice pvc helmrelease customresource | teamId, provider, parentId, region, clusterName, page, namespace, kindLower, name | `https://nuphos.ai/teams/<teamId>/infra/<provider>/<parentId>/clusters/<region>/<clusterName>/<page>/namespaces/<namespace>/resources/<kindLower>/<name>` | resource name

Useful page values for K8s resource details:

- Node: `nodes`, kindLower `node`, cluster-scoped
- Pod: `workloads/pods`, kindLower `pod`, namespaced
- Deployment: `workloads/deployments`, kindLower `deployment`, namespaced
- ReplicaSet: `workloads/replicasets`, kindLower `replicaset`, namespaced
- StatefulSet: `workloads/statefulsets`, kindLower `statefulset`, namespaced
- DaemonSet: `workloads/daemonsets`, kindLower `daemonset`, namespaced
- Job: `workloads/jobs`, kindLower `job`, namespaced
- CronJob: `workloads/cronjobs`, kindLower `cronjob`, namespaced
- HelmRelease: `helm/releases`, kindLower `helmrelease`, namespaced
- Service: `networking/services`, kindLower `service`, namespaced
- Ingress: `networking/ingresses`, kindLower `ingress`, namespaced
- EndpointSlice: `networking/endpoint-slices`, kindLower `endpointslice`, namespaced
- NetworkPolicy: `networking/network-policies`, kindLower `networkpolicy`, namespaced
- ServiceAccount: `access/service-accounts`, kindLower `serviceaccount`, namespaced
- Role: `access/roles`, kindLower `role`, namespaced
- RoleBinding: `access/role-bindings`, kindLower `rolebinding`, namespaced
- ClusterRole: `access/cluster-roles`, kindLower `clusterrole`, cluster-scoped
- ClusterRoleBinding: `access/cluster-role-bindings`, kindLower `clusterrolebinding`, cluster-scoped
- ConfigMap: `config/configmaps`, kindLower `configmap`, namespaced
- Secret: `config/secrets`, kindLower `secret`, namespaced
- StorageClass: `storage/storage-classes`, kindLower `storageclass`, cluster-scoped
- PersistentVolume: `storage/persistent-volumes`, kindLower `persistentvolume`, cluster-scoped
- PersistentVolumeClaim: `storage/persistent-volume-claims`, kindLower `persistentvolumeclaim`, namespaced
- CustomResourceDefinition: `custom/crds`, kindLower `customresourcedefinition`, cluster-scoped
- CustomResource: `custom/resources`, kindLower `customresource`, namespaced
