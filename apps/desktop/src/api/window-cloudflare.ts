import type {
  CloudflareR2Bucket,
  CloudflareR2BucketInput,
  CloudflareR2BucketUsage,
  CloudflareR2CredentialsStatus,
  CloudflareR2CustomDomain,
  CloudflareR2ManagedDomain,
  CloudflareR2ObjectListing,
  CloudflareR2ObjectPreview,
  CloudflareWorkerCronTrigger,
  CloudflareWorkerDeployment,
  CloudflareWorkerDomain,
  CloudflareWorkerScript,
  CloudflareWorkerSettings,
} from '../types/cloudflare.ts'
import type { CloudflareDnsRecord, CloudflareDnsRecordInput, CloudflareZone } from '../types/iam.ts'
import type { CloudflareAccount } from '../types/provider-accounts.ts'

export type WindowCloudflareApi = {
  atlasListCloudflareAccounts(teamId: string): Promise<CloudflareAccount[]>
  atlasListCloudflareZones(teamId: string, accountId: string): Promise<CloudflareZone[]>
  atlasListCloudflareDnsRecords(
    teamId: string,
    accountId: string,
    zoneId: string,
  ): Promise<CloudflareDnsRecord[]>
  atlasCreateCloudflareDnsRecord(
    teamId: string,
    accountId: string,
    zoneId: string,
    input: CloudflareDnsRecordInput,
  ): Promise<CloudflareDnsRecord>
  atlasUpdateCloudflareDnsRecord(
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
    input: CloudflareDnsRecordInput,
  ): Promise<CloudflareDnsRecord>
  atlasDeleteCloudflareDnsRecord(
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
  ): Promise<void>
  atlasListCloudflareWorkers(teamId: string, accountId: string): Promise<CloudflareWorkerScript[]>
  atlasListCloudflareWorkerDomains(
    teamId: string,
    accountId: string,
  ): Promise<CloudflareWorkerDomain[]>
  atlasGetCloudflareWorkerSettings(
    teamId: string,
    accountId: string,
    scriptName: string,
  ): Promise<CloudflareWorkerSettings>
  atlasListCloudflareWorkerCronTriggers(
    teamId: string,
    accountId: string,
    scriptName: string,
  ): Promise<CloudflareWorkerCronTrigger[]>
  atlasUpdateCloudflareWorkerCronTriggers(
    teamId: string,
    accountId: string,
    scriptName: string,
    crons: string[],
  ): Promise<CloudflareWorkerCronTrigger[]>
  atlasListCloudflareWorkerDeployments(
    teamId: string,
    accountId: string,
    scriptName: string,
  ): Promise<CloudflareWorkerDeployment[]>
  atlasGetCloudflareWorkerSubdomain(
    teamId: string,
    accountId: string,
    scriptName: string,
  ): Promise<boolean | null>
  atlasDeleteCloudflareWorker(teamId: string, accountId: string, scriptName: string): Promise<void>
  atlasGetCloudflareR2Credentials(
    teamId: string,
    accountId: string,
  ): Promise<CloudflareR2CredentialsStatus>
  atlasBindCloudflareR2Credentials(
    teamId: string,
    accountId: string,
    input: { accessKeyId: string; secretAccessKey: string },
  ): Promise<CloudflareR2CredentialsStatus>
  atlasUnbindCloudflareR2Credentials(teamId: string, accountId: string): Promise<void>
  atlasListCloudflareR2Buckets(teamId: string, accountId: string): Promise<CloudflareR2Bucket[]>
  atlasCreateCloudflareR2Bucket(
    teamId: string,
    accountId: string,
    input: CloudflareR2BucketInput,
  ): Promise<CloudflareR2Bucket>
  atlasDeleteCloudflareR2Bucket(
    teamId: string,
    accountId: string,
    bucketName: string,
  ): Promise<void>
  atlasGetCloudflareR2BucketUsage(
    teamId: string,
    accountId: string,
    bucketName: string,
  ): Promise<CloudflareR2BucketUsage>
  atlasGetCloudflareR2ManagedDomain(
    teamId: string,
    accountId: string,
    bucketName: string,
  ): Promise<CloudflareR2ManagedDomain>
  atlasSetCloudflareR2ManagedDomain(
    teamId: string,
    accountId: string,
    bucketName: string,
    enabled: boolean,
  ): Promise<CloudflareR2ManagedDomain>
  atlasListCloudflareR2CustomDomains(
    teamId: string,
    accountId: string,
    bucketName: string,
  ): Promise<CloudflareR2CustomDomain[]>
  atlasAddCloudflareR2CustomDomain(
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { domain: string; zoneId: string; enabled?: boolean },
  ): Promise<void>
  atlasDeleteCloudflareR2CustomDomain(
    teamId: string,
    accountId: string,
    bucketName: string,
    domain: string,
  ): Promise<void>
  atlasListCloudflareR2Objects(
    teamId: string,
    accountId: string,
    bucketName: string,
    prefix: string,
    cursor: string | null,
  ): Promise<CloudflareR2ObjectListing>
  atlasGetCloudflareR2ObjectDownloadUrl(
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ): Promise<string>
  atlasGetCloudflareR2ObjectPreview(
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ): Promise<CloudflareR2ObjectPreview>
  atlasPutCloudflareR2Object(
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { key: string; contentBase64: string; contentType?: string },
  ): Promise<void>
  atlasDeleteCloudflareR2Object(
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ): Promise<void>
}
