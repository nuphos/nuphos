export type ClusterResult = {
  provider: 'aws' | 'gcp' | 'tencent' | 'aliyun' | 'volcengine' | 'azure'
  name: string
  region: string
  endpoint?: string
  /** Base64-encoded PEM CA bundle — required to render a kubeconfig entry. */
  caBase64?: string
  status?: string
  version?: string
  createdAt?: Date
  awsRoleArn?: string
  awsClusterArn?: string
  gcpServiceAccountEmail?: string
  gcpProjectId?: string
  gcpResourceName?: string
  /** Nuphos Tencent account binding id — maps the cluster back to its creds. */
  tencentAccountId?: string
  /** TKE cluster id (cls-xxxx) — the handle every TKE API call needs. */
  tencentClusterId?: string
  /** Nuphos Aliyun account binding id — maps the cluster back to its creds. */
  aliyunAccountId?: string
  /** ACK cluster id — the handle every ACK API call needs. */
  aliyunClusterId?: string
  /** Nuphos Volcengine account binding id — maps the cluster back to its creds. */
  volcengineAccountId?: string
  /** VKE cluster id — the handle every VKE API call needs. */
  volcengineClusterId?: string
  /** Nuphos Azure account binding id — maps the cluster back to its creds. */
  azureAccountId?: string
  /** ARM resource group the AKS managed cluster lives in (needed for kubeconfig). */
  azureResourceGroup?: string
}

/**
 * Alibaba Cloud has two isolated partitions (like AWS `aws` vs `aws-cn`), each
 * with its own accounts, credentials, regions and API endpoints:
 *  - `china`         — aliyun.com (mainland China; cn-xxx regions)
 *  - `international`  — alibabacloud.com (global; ap-xxx / us-xxx / eu-xxx regions)
 * A credential from one partition cannot be used against the other, so every
 * binding records which site it belongs to and endpoints are chosen from it.
 */
export type AliyunSite = 'china' | 'international'

/**
 * Tencent Cloud has the same split (like AWS `aws` vs `aws-cn` / Aliyun):
 *  - `china`         — cloud.tencent.com (mainland regions: ap-guangzhou, …)
 *  - `international`  — tencentcloud.com (overseas regions only: ap-hongkong,
 *    ap-singapore, …; served from the `*.intl.tencentcloudapi.com` endpoints)
 * Credentials are account-partition scoped and not interchangeable, so every
 * binding records which site it belongs to and endpoints are chosen from it.
 */
export type TencentSite = 'china' | 'international'

export type BindingError = {
  provider: 'aws' | 'gcp' | 'tencent' | 'aliyun' | 'volcengine' | 'azure'
  accountId?: string
  projectId?: string
  region?: string
  message: string
}

export type ListClustersResult = {
  clusters: ClusterResult[]
  errors: BindingError[]
}
