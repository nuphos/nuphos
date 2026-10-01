export type Vpc = {
  id: string
  name?: string
  cidr?: string
  region?: string
  state?: string
}

export type NaclEntry = {
  ruleNumber: number
  ruleAction: 'allow' | 'deny'
  egress: boolean
  protocol: string
  cidrBlock?: string
  ipv6CidrBlock?: string
  portRange?: { from: number; to: number }
}

export type Nacl = {
  id: string
  vpcId: string
  region: string
  isDefault?: boolean
  entries?: NaclEntry[]
  associations?: { subnetId: string }[]
}

export type Firewall = {
  name: string
  network?: string
  direction?: string
  priority?: number
  sourceRanges?: string[]
  allowed?: { protocol: string; ports?: string[] }[]
}

export type AwsEc2Instance = {
  instanceId: string
  instanceType: string
  state: string
  region: string
  availabilityZone: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  imageId?: string | null
  tags: Record<string, string>
}

// Tencent CVM (Cloud Virtual Machine) server — the Tencent analogue of EC2.
export type TencentCvmInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

// Aliyun ECS (Elastic Compute Service) server — the Alibaba Cloud analogue of
// EC2 / Tencent CVM.
export type AliyunEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

// Aliyun Simple Application Server (轻量应用服务器) — the Alibaba analogue of
// AWS Lightsail / Tencent Lighthouse.
export type AliyunSwasInstance = {
  instanceId: string
  name: string
  plan: string
  status: string
  businessStatus: string | null
  region: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  diskGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
  expiredAt: string | null
}

// Volcengine ECS (Elastic Compute Service) server — the Volcengine analogue of
// EC2 / Tencent CVM / Aliyun ECS.
export type VolcengineEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

export type GcpComputeInstance = {
  name: string
  id: string | null
  zone: string
  region: string
  machineType: string
  status: string
  publicIp: string | null
  privateIp: string | null
  network: string | null
  subnetwork: string | null
  serviceAccounts: string[]
  labels: Record<string, string>
  createdAt: string | null
}

// Cloud Monitoring metrics explorer — mirrors electron/atlas.ts.
