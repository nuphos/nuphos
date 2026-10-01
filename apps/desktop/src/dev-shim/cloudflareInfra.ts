/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendQuery, call, noop } from './http.ts'

export function cloudflareInfraMethods(): Record<string, any> {
  return {
    atlasListClusters: (teamId: string) => call('GET', `/teams/${teamId}/clusters`),
    atlasUseCluster: noop,
    atlasListAwsAccounts: (teamId: string) =>
      call('GET', `/teams/${teamId}/aws-accounts`).then((d: any) => d.accounts ?? []),
    atlasListGcpProjects: (teamId: string) =>
      call('GET', `/teams/${teamId}/gcp-projects`).then((d: any) => d.projects ?? []),
    atlasListCloudflareAccounts: (teamId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts`).then((d: any) => d.accounts ?? []),
    atlasListCloudflareZones: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/zones`).then(
        (d: any) => d.zones ?? [],
      ),
    atlasListCloudflareDnsRecords: (teamId: string, accountId: string, zoneId: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records`,
      ).then((d: any) => d.records ?? []),
    atlasCreateCloudflareDnsRecord: (
      teamId: string,
      accountId: string,
      zoneId: string,
      input: unknown,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records`,
        input,
      ),
    atlasUpdateCloudflareDnsRecord: (
      teamId: string,
      accountId: string,
      zoneId: string,
      recordId: string,
      input: unknown,
    ) =>
      call(
        'PUT',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records/${recordId}`,
        input,
      ),
    atlasDeleteCloudflareDnsRecord: (
      teamId: string,
      accountId: string,
      zoneId: string,
      recordId: string,
    ) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records/${recordId}`,
      ),
    // --- Cloudflare Workers ---
    atlasListCloudflareWorkers: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts`).then(
        (d: any) => d.scripts ?? [],
      ),
    atlasListCloudflareWorkerDomains: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/domains`).then(
        (d: any) => d.domains ?? [],
      ),
    atlasGetCloudflareWorkerSettings: (teamId: string, accountId: string, scriptName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}/settings`,
      ),
    atlasListCloudflareWorkerCronTriggers: (
      teamId: string,
      accountId: string,
      scriptName: string,
    ) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}/schedules`,
      ).then((d: any) => d.schedules ?? []),
    atlasUpdateCloudflareWorkerCronTriggers: (
      teamId: string,
      accountId: string,
      scriptName: string,
      crons: string[],
    ) =>
      call(
        'PUT',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}/schedules`,
        { crons },
      ).then((d: any) => d.schedules ?? []),
    atlasListCloudflareWorkerDeployments: (teamId: string, accountId: string, scriptName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}/deployments`,
      ).then((d: any) => d.deployments ?? []),
    atlasGetCloudflareWorkerSubdomain: (teamId: string, accountId: string, scriptName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}/subdomain`,
      ).then((d: any) => d.enabled ?? null),
    atlasDeleteCloudflareWorker: (teamId: string, accountId: string, scriptName: string) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/workers/scripts/${encodeURIComponent(
          scriptName,
        )}`,
      ),
    // --- Cloudflare R2 ---
    atlasGetCloudflareR2Credentials: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/s3-credentials`),
    atlasBindCloudflareR2Credentials: (teamId: string, accountId: string, input: unknown) =>
      call('PUT', `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/s3-credentials`, input),
    atlasUnbindCloudflareR2Credentials: (teamId: string, accountId: string) =>
      call('DELETE', `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/s3-credentials`),
    atlasListCloudflareR2Buckets: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets`).then(
        (d: any) => d.buckets ?? [],
      ),
    atlasCreateCloudflareR2Bucket: (teamId: string, accountId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets`, input),
    atlasDeleteCloudflareR2Bucket: (teamId: string, accountId: string, bucketName: string) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}`,
      ),
    atlasGetCloudflareR2BucketUsage: (teamId: string, accountId: string, bucketName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/usage`,
      ),
    atlasGetCloudflareR2ManagedDomain: (teamId: string, accountId: string, bucketName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/managed-domain`,
      ),
    atlasSetCloudflareR2ManagedDomain: (
      teamId: string,
      accountId: string,
      bucketName: string,
      enabled: boolean,
    ) =>
      call(
        'PUT',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/managed-domain`,
        { enabled },
      ),
    atlasListCloudflareR2CustomDomains: (teamId: string, accountId: string, bucketName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/custom-domains`,
      ).then((d: any) => d.domains ?? []),
    atlasAddCloudflareR2CustomDomain: (
      teamId: string,
      accountId: string,
      bucketName: string,
      input: unknown,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/custom-domains`,
        input,
      ),
    atlasDeleteCloudflareR2CustomDomain: (
      teamId: string,
      accountId: string,
      bucketName: string,
      domain: string,
    ) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/custom-domains/${encodeURIComponent(domain)}`,
      ),
    atlasListCloudflareR2Objects: (
      teamId: string,
      accountId: string,
      bucketName: string,
      prefix: string,
      cursor: string | null,
    ) =>
      call(
        'GET',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
            bucketName,
          )}/objects`,
          { prefix: prefix || undefined, cursor: cursor || undefined },
        ),
      ),
    atlasGetCloudflareR2ObjectDownloadUrl: (
      teamId: string,
      accountId: string,
      bucketName: string,
      key: string,
    ) =>
      call(
        'GET',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
            bucketName,
          )}/objects/download`,
          { key },
        ),
      ).then((d: any) => d.url),
    atlasGetCloudflareR2ObjectPreview: (
      teamId: string,
      accountId: string,
      bucketName: string,
      key: string,
    ) =>
      call(
        'GET',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
            bucketName,
          )}/objects/preview`,
          { key },
        ),
      ),
    atlasPutCloudflareR2Object: (
      teamId: string,
      accountId: string,
      bucketName: string,
      input: unknown,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
          bucketName,
        )}/objects`,
        input,
      ),
    atlasDeleteCloudflareR2Object: (
      teamId: string,
      accountId: string,
      bucketName: string,
      key: string,
    ) =>
      call(
        'DELETE',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/r2/buckets/${encodeURIComponent(
            bucketName,
          )}/objects`,
          { key },
        ),
      ),
  }
}
