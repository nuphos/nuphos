export type TailscaleSandboxAccess = {
  enabled: boolean
  tag: string
  enabledAt?: string
}

export type TailscaleOAuthClient = {
  id: string
  label: string
  clientId: string
  createdAt?: string
  sandboxAccess?: TailscaleSandboxAccess | null
}

export type ZeaburProvider = {
  providerId: string
  zeaburId: string
  kind: 'user' | 'team'
  name: string
  createdAt?: string
}

export type ZeaburProject = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
}

export type ZeaburServer = {
  id: string
  name: string
  status: string | null
  region: string | null
  createdAt: string | null
  ip?: string | null
  sshPort?: number | null
  sshUsername?: string | null
  isOnline?: boolean | null
  vmStatus?: string | null
  sshAvailable?: boolean | null
  latency?: number | null
  totalCPU?: number | null
  usedCPU?: number | null
  totalMemory?: number | null
  usedMemory?: number | null
  totalDisk?: number | null
  usedDisk?: number | null
  warnings?: string[]
}

export type LinodeInstance = {
  id: number
  label: string
  region: string
  type: string
  status: string
  ipv4: string[]
  ipv6: string | null
  created: string | null
}

export type HetznerServer = {
  id: number
  name: string
  status: string
  serverType: string
  location: string
  ipv4: string | null
  ipv6: string | null
  created: string | null
}

export type TailscaleDevice = {
  id: string
  name: string
  hostname: string | null
  os: string | null
  user: string | null
  addresses: string[]
  tags: string[]
  online: boolean | null
  authorized: boolean | null
  createdAt: string | null
  lastSeen: string | null
  expiresAt: string | null
}

export type LkeCluster = {
  id: number
  label: string
  region: string
  k8s_version: string
  status: string
  created: string | null
}

export type BetterStackIntegration = {
  id: string
  label: string
  hasUptimeApiToken: boolean
  hasTelemetryApiToken: boolean
  createdAt: string
}

export type BetterStackMonitor = {
  id: string
  type: string
  url: string | null
  pronounceableName: string | null
  monitorType: string | null
  status: string | null
  checkFrequency: number | null
  teamName: string | null
  pausedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackSource = {
  id: string
  type: string
  name: string | null
  teamName: string | null
  platform: string | null
  tableName: string | null
  ingestingHost: string | null
  ingestingPaused: boolean
  logsRetention: number | null
  metricsRetention: number | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackCollector = {
  id: string
  type: string
  name: string | null
  platform: string | null
  status: string | null
  teamName: string | null
  dataRegion: string | null
  ingestingPaused: boolean
  pingedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackHeartbeat = {
  id: string
  type: string
  name: string | null
  status: string | null
  period: number | null
  grace: number | null
  pausedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackIncident = {
  id: string
  type: string
  name: string | null
  cause: string | null
  status: string | null
  url: string | null
  httpMethod: string | null
  startedAt: string | null
  acknowledgedAt: string | null
  resolvedAt: string | null
}

export type BetterStackDashboard = {
  id: string
  type: string
  name: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type UptimeKumaInstance = {
  id: string
  label: string
  baseUrl: string
  username: string | null
  authType: 'password' | 'token'
  createdAt: string
}

export type UptimeKumaMonitor = {
  id: number
  name?: string | null
  type?: string | null
  url?: string | null
  active?: boolean | null
  interval?: number | null
  retryInterval?: number | null
  resendInterval?: number | null
  maxretries?: number | null
  accepted_statuscodes?: string[] | null
  status?: string | number | null
  parent?: string | number | null
  childrenIDs?: (string | number)[] | null
  weight?: string | number | null
  pathName?: string | null
  tags?: unknown[] | null
}
