/* eslint-disable @typescript-eslint/no-explicit-any */
import { call } from './http.ts'

export function cloudflarePagesD1Methods(): Record<string, any> {
  return {
    // --- Cloudflare Pages ---
    atlasListCloudflarePagesProjects: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects`).then(
        (d: any) => d.projects ?? [],
      ),
    atlasGetCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}`,
      ),
    atlasDeleteCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}`,
      ),
    atlasListCloudflarePagesDeployments: (teamId: string, accountId: string, projectName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments`,
      ).then((d: any) => d.deployments ?? []),
    atlasCreateCloudflarePagesDeployment: (
      teamId: string,
      accountId: string,
      projectName: string,
      branch?: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments`,
        branch ? { branch } : {},
      ),
    atlasRetryCloudflarePagesDeployment: (
      teamId: string,
      accountId: string,
      projectName: string,
      deploymentId: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments/${encodeURIComponent(deploymentId)}/retry`,
      ),
    atlasRollbackCloudflarePagesDeployment: (
      teamId: string,
      accountId: string,
      projectName: string,
      deploymentId: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      ),
    atlasGetCloudflarePagesDeploymentLogs: (
      teamId: string,
      accountId: string,
      projectName: string,
      deploymentId: string,
    ) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments/${encodeURIComponent(deploymentId)}/logs`,
      ).then((d: any) => d.logs ?? []),
    atlasListCloudflarePagesDomains: (teamId: string, accountId: string, projectName: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/domains`,
      ).then((d: any) => d.domains ?? []),
    atlasAddCloudflarePagesDomain: (
      teamId: string,
      accountId: string,
      projectName: string,
      name: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/domains`,
        { name },
      ),
    atlasDeleteCloudflarePagesDomain: (
      teamId: string,
      accountId: string,
      projectName: string,
      name: string,
    ) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/pages/projects/${encodeURIComponent(
          projectName,
        )}/domains/${encodeURIComponent(name)}`,
      ),
    // --- Cloudflare D1 ---
    atlasListCloudflareD1Databases: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases`).then(
        (d: any) => d.databases ?? [],
      ),
    atlasCreateCloudflareD1Database: (teamId: string, accountId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases`, input),
    atlasGetCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases/${encodeURIComponent(
          databaseId,
        )}`,
      ),
    atlasOpenCloudflareD1InDatabases: (teamId: string, accountId: string, databaseId: string) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases/${encodeURIComponent(
          databaseId,
        )}/open-in-databases`,
      ),
    atlasDeleteCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases/${encodeURIComponent(
          databaseId,
        )}`,
      ),
    atlasListCloudflareD1Tables: (teamId: string, accountId: string, databaseId: string) =>
      call(
        'GET',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases/${encodeURIComponent(
          databaseId,
        )}/tables`,
      ).then((d: any) => d.tables ?? []),
    atlasQueryCloudflareD1: (
      teamId: string,
      accountId: string,
      databaseId: string,
      sql: string,
      params?: string[],
    ) =>
      call(
        'POST',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/d1/databases/${encodeURIComponent(
          databaseId,
        )}/query`,
        params && params.length > 0 ? { sql, params } : { sql },
      ),
  }
}
