// --- Cloudflare Workers ---
export type CloudflareWorkerScript = {
  name: string
  usageModel: string | null
  createdOn: string | null
  modifiedOn: string | null
}

export type CloudflareWorkerBinding = {
  type: string
  name: string
  target: string | null
}

export type CloudflareWorkerSettings = {
  compatibilityDate: string | null
  compatibilityFlags: string[]
  usageModel: string | null
  observabilityEnabled: boolean | null
  bindings: CloudflareWorkerBinding[]
}

export type CloudflareWorkerCronTrigger = {
  cron: string
  createdOn: string | null
  modifiedOn: string | null
}

export type CloudflareWorkerDeployment = {
  id: string
  source: string | null
  authorEmail: string | null
  createdOn: string | null
}

export type CloudflareWorkerDomain = {
  id: string
  hostname: string
  zoneName: string | null
  service: string | null
  environment: string | null
}

// --- Cloudflare R2 ---
export type CloudflareR2Bucket = {
  name: string
  creationDate: string | null
  location: string | null
  storageClass: string | null
}

export type CloudflareR2BucketUsage = {
  payloadSize: number | null
  metadataSize: number | null
  objectCount: number | null
}

export type CloudflareR2ManagedDomain = {
  domain: string | null
  enabled: boolean
}

export type CloudflareR2CustomDomain = {
  domain: string
  enabled: boolean
  status: string | null
}

export type CloudflareR2Object = {
  key: string
  size: number
  lastModified: string | null
  etag: string | null
}

export type CloudflareR2ObjectListing = {
  prefix: string
  prefixes: string[]
  objects: CloudflareR2Object[]
  isTruncated: boolean
  nextContinuationToken: string | null
}

export type CloudflareR2ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export type CloudflareR2CredentialsStatus = {
  bound: boolean
  accessKeyId: string | null
  createdAt: string | null
}

export type CloudflareR2BucketInput = {
  name: string
  locationHint?: string
  storageClass?: string
}

// --- Cloudflare Pages ---
export type CloudflarePagesDeploymentSummary = {
  id: string
  shortId: string | null
  environment: string | null
  url: string | null
  createdOn: string | null
  modifiedOn: string | null
  stageName: string | null
  stageStatus: string | null
  branch: string | null
  commitHash: string | null
  commitMessage: string | null
}

export type CloudflarePagesProject = {
  id: string | null
  name: string
  subdomain: string | null
  domains: string[]
  productionBranch: string | null
  source: string | null
  createdOn: string | null
  latestDeployment: CloudflarePagesDeploymentSummary | null
}

export type CloudflarePagesDomain = {
  id: string | null
  name: string
  status: string | null
}

export type CloudflarePagesLogLine = {
  ts: string | null
  line: string
}

// --- Cloudflare D1 ---
export type CloudflareD1Database = {
  uuid: string
  name: string
  version: string | null
  numTables: number | null
  fileSize: number | null
  createdAt: string | null
  runningInRegion: string | null
}

export type CloudflareD1QueryMeta = {
  durationMs: number | null
  rowsRead: number | null
  rowsWritten: number | null
  changes: number | null
  lastRowId: number | null
  sizeAfter: number | null
}

export type CloudflareD1QueryResult = {
  success: boolean
  results: Record<string, unknown>[]
  columns: string[]
  meta: CloudflareD1QueryMeta | null
}

export type CloudflareD1DatabaseInput = {
  name: string
  primaryLocationHint?: string
}

// --- Cloudflare KV ---
export type CloudflareKvNamespace = {
  id: string
  title: string
  supportsUrlEncoding: boolean
}

export type CloudflareKvKey = {
  name: string
  expiration: number | null
  metadata: Record<string, unknown> | null
}

export type CloudflareKvKeyPage = {
  keys: CloudflareKvKey[]
  cursor: string | null
  listComplete: boolean
}

export type CloudflareKvValue = {
  value: string
  isText: boolean
}
