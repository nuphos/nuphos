import type { CloudflareR2BucketInput } from '../types/cloudflare.ts'
import type { CloudflareDnsRecordInput } from '../types/iam.ts'

export const cloudflareApi = {
  atlasListCloudflareAccounts: (teamId: string) => window.api.atlasListCloudflareAccounts(teamId),
  atlasListCloudflareZones: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareZones(teamId, accountId),
  atlasListCloudflareDnsRecords: (teamId: string, accountId: string, zoneId: string) =>
    window.api.atlasListCloudflareDnsRecords(teamId, accountId, zoneId),
  atlasCreateCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    input: CloudflareDnsRecordInput,
  ) => window.api.atlasCreateCloudflareDnsRecord(teamId, accountId, zoneId, input),
  atlasUpdateCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
    input: CloudflareDnsRecordInput,
  ) => window.api.atlasUpdateCloudflareDnsRecord(teamId, accountId, zoneId, recordId, input),
  atlasDeleteCloudflareDnsRecord: (
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
  ) => window.api.atlasDeleteCloudflareDnsRecord(teamId, accountId, zoneId, recordId),
  // --- Cloudflare Workers ---
  atlasListCloudflareWorkers: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareWorkers(teamId, accountId),
  atlasListCloudflareWorkerDomains: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareWorkerDomains(teamId, accountId),
  atlasGetCloudflareWorkerSettings: (teamId: string, accountId: string, scriptName: string) =>
    window.api.atlasGetCloudflareWorkerSettings(teamId, accountId, scriptName),
  atlasListCloudflareWorkerCronTriggers: (teamId: string, accountId: string, scriptName: string) =>
    window.api.atlasListCloudflareWorkerCronTriggers(teamId, accountId, scriptName),
  atlasUpdateCloudflareWorkerCronTriggers: (
    teamId: string,
    accountId: string,
    scriptName: string,
    crons: string[],
  ) => window.api.atlasUpdateCloudflareWorkerCronTriggers(teamId, accountId, scriptName, crons),
  atlasListCloudflareWorkerDeployments: (teamId: string, accountId: string, scriptName: string) =>
    window.api.atlasListCloudflareWorkerDeployments(teamId, accountId, scriptName),
  atlasGetCloudflareWorkerSubdomain: (teamId: string, accountId: string, scriptName: string) =>
    window.api.atlasGetCloudflareWorkerSubdomain(teamId, accountId, scriptName),
  atlasDeleteCloudflareWorker: (teamId: string, accountId: string, scriptName: string) =>
    window.api.atlasDeleteCloudflareWorker(teamId, accountId, scriptName),
  // --- Cloudflare R2 ---
  atlasGetCloudflareR2Credentials: (teamId: string, accountId: string) =>
    window.api.atlasGetCloudflareR2Credentials(teamId, accountId),
  atlasBindCloudflareR2Credentials: (
    teamId: string,
    accountId: string,
    input: { accessKeyId: string; secretAccessKey: string },
  ) => window.api.atlasBindCloudflareR2Credentials(teamId, accountId, input),
  atlasUnbindCloudflareR2Credentials: (teamId: string, accountId: string) =>
    window.api.atlasUnbindCloudflareR2Credentials(teamId, accountId),
  atlasListCloudflareR2Buckets: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareR2Buckets(teamId, accountId),
  atlasCreateCloudflareR2Bucket: (
    teamId: string,
    accountId: string,
    input: CloudflareR2BucketInput,
  ) => window.api.atlasCreateCloudflareR2Bucket(teamId, accountId, input),
  atlasDeleteCloudflareR2Bucket: (teamId: string, accountId: string, bucketName: string) =>
    window.api.atlasDeleteCloudflareR2Bucket(teamId, accountId, bucketName),
  atlasGetCloudflareR2BucketUsage: (teamId: string, accountId: string, bucketName: string) =>
    window.api.atlasGetCloudflareR2BucketUsage(teamId, accountId, bucketName),
  atlasGetCloudflareR2ManagedDomain: (teamId: string, accountId: string, bucketName: string) =>
    window.api.atlasGetCloudflareR2ManagedDomain(teamId, accountId, bucketName),
  atlasSetCloudflareR2ManagedDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    enabled: boolean,
  ) => window.api.atlasSetCloudflareR2ManagedDomain(teamId, accountId, bucketName, enabled),
  atlasListCloudflareR2CustomDomains: (teamId: string, accountId: string, bucketName: string) =>
    window.api.atlasListCloudflareR2CustomDomains(teamId, accountId, bucketName),
  atlasAddCloudflareR2CustomDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { domain: string; zoneId: string; enabled?: boolean },
  ) => window.api.atlasAddCloudflareR2CustomDomain(teamId, accountId, bucketName, input),
  atlasDeleteCloudflareR2CustomDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    domain: string,
  ) => window.api.atlasDeleteCloudflareR2CustomDomain(teamId, accountId, bucketName, domain),
  atlasListCloudflareR2Objects: (
    teamId: string,
    accountId: string,
    bucketName: string,
    prefix: string,
    cursor: string | null,
  ) => window.api.atlasListCloudflareR2Objects(teamId, accountId, bucketName, prefix, cursor),
  atlasGetCloudflareR2ObjectDownloadUrl: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => window.api.atlasGetCloudflareR2ObjectDownloadUrl(teamId, accountId, bucketName, key),
  atlasGetCloudflareR2ObjectPreview: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => window.api.atlasGetCloudflareR2ObjectPreview(teamId, accountId, bucketName, key),
  atlasPutCloudflareR2Object: (
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { key: string; contentBase64: string; contentType?: string },
  ) => window.api.atlasPutCloudflareR2Object(teamId, accountId, bucketName, input),
  atlasDeleteCloudflareR2Object: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => window.api.atlasDeleteCloudflareR2Object(teamId, accountId, bucketName, key),
  // --- Cloudflare Pages ---
}
