import * as atlas from '../atlas'

export const cloudflareChannels = {
  'atlas:listCloudflareAccounts': (_e: unknown, teamId: string) =>
    atlas.listCloudflareAccounts(teamId),
  'atlas:listCloudflareZones': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareZones(teamId, accountId),
  'atlas:listCloudflareDnsRecords': (
    _e: unknown,
    teamId: string,
    accountId: string,
    zoneId: string,
  ) => atlas.listCloudflareDnsRecords(teamId, accountId, zoneId),
  'atlas:createCloudflareDnsRecord': (
    _e: unknown,
    teamId: string,
    accountId: string,
    zoneId: string,
    input: atlas.CloudflareDnsRecordInput,
  ) => atlas.createCloudflareDnsRecord(teamId, accountId, zoneId, input),
  'atlas:updateCloudflareDnsRecord': (
    _e: unknown,
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
    input: atlas.CloudflareDnsRecordInput,
  ) => atlas.updateCloudflareDnsRecord(teamId, accountId, zoneId, recordId, input),
  'atlas:deleteCloudflareDnsRecord': (
    _e: unknown,
    teamId: string,
    accountId: string,
    zoneId: string,
    recordId: string,
  ) => atlas.deleteCloudflareDnsRecord(teamId, accountId, zoneId, recordId),
  // --- Cloudflare Workers ---
  'atlas:listCloudflareWorkers': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareWorkers(teamId, accountId),
  'atlas:listCloudflareWorkerDomains': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareWorkerDomains(teamId, accountId),
  'atlas:getCloudflareWorkerSettings': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
  ) => atlas.getCloudflareWorkerSettings(teamId, accountId, scriptName),
  'atlas:listCloudflareWorkerCronTriggers': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
  ) => atlas.listCloudflareWorkerCronTriggers(teamId, accountId, scriptName),
  'atlas:updateCloudflareWorkerCronTriggers': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
    crons: string[],
  ) => atlas.updateCloudflareWorkerCronTriggers(teamId, accountId, scriptName, crons),
  'atlas:listCloudflareWorkerDeployments': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
  ) => atlas.listCloudflareWorkerDeployments(teamId, accountId, scriptName),
  'atlas:getCloudflareWorkerSubdomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
  ) => atlas.getCloudflareWorkerSubdomain(teamId, accountId, scriptName),
  'atlas:deleteCloudflareWorker': (
    _e: unknown,
    teamId: string,
    accountId: string,
    scriptName: string,
  ) => atlas.deleteCloudflareWorker(teamId, accountId, scriptName),
  // --- Cloudflare R2 ---
  'atlas:getCloudflareR2Credentials': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getCloudflareR2Credentials(teamId, accountId),
  'atlas:bindCloudflareR2Credentials': (
    _e: unknown,
    teamId: string,
    accountId: string,
    input: { accessKeyId: string; secretAccessKey: string },
  ) => atlas.bindCloudflareR2Credentials(teamId, accountId, input),
  'atlas:unbindCloudflareR2Credentials': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindCloudflareR2Credentials(teamId, accountId),
  'atlas:listCloudflareR2Buckets': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareR2Buckets(teamId, accountId),
  'atlas:createCloudflareR2Bucket': (
    _e: unknown,
    teamId: string,
    accountId: string,
    input: atlas.CloudflareR2BucketInput,
  ) => atlas.createCloudflareR2Bucket(teamId, accountId, input),
  'atlas:deleteCloudflareR2Bucket': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
  ) => atlas.deleteCloudflareR2Bucket(teamId, accountId, bucketName),
  'atlas:getCloudflareR2BucketUsage': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
  ) => atlas.getCloudflareR2BucketUsage(teamId, accountId, bucketName),
  'atlas:getCloudflareR2ManagedDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
  ) => atlas.getCloudflareR2ManagedDomain(teamId, accountId, bucketName),
  'atlas:setCloudflareR2ManagedDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    enabled: boolean,
  ) => atlas.setCloudflareR2ManagedDomain(teamId, accountId, bucketName, enabled),
  'atlas:listCloudflareR2CustomDomains': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
  ) => atlas.listCloudflareR2CustomDomains(teamId, accountId, bucketName),
  'atlas:addCloudflareR2CustomDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { domain: string; zoneId: string; enabled?: boolean },
  ) => atlas.addCloudflareR2CustomDomain(teamId, accountId, bucketName, input),
  'atlas:deleteCloudflareR2CustomDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    domain: string,
  ) => atlas.deleteCloudflareR2CustomDomain(teamId, accountId, bucketName, domain),
  'atlas:listCloudflareR2Objects': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    prefix: string,
    cursor: string | null,
  ) => atlas.listCloudflareR2Objects(teamId, accountId, bucketName, prefix, cursor),
  'atlas:getCloudflareR2ObjectDownloadUrl': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => atlas.getCloudflareR2ObjectDownloadUrl(teamId, accountId, bucketName, key),
  'atlas:getCloudflareR2ObjectPreview': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => atlas.getCloudflareR2ObjectPreview(teamId, accountId, bucketName, key),
  'atlas:putCloudflareR2Object': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    input: { key: string; contentBase64: string; contentType?: string },
  ) => atlas.putCloudflareR2Object(teamId, accountId, bucketName, input),
  'atlas:deleteCloudflareR2Object': (
    _e: unknown,
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => atlas.deleteCloudflareR2Object(teamId, accountId, bucketName, key),
} as const
