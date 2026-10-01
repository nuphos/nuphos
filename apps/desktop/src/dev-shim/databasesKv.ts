/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendQuery, call } from './http.ts'

export function databasesKvMethods(): Record<string, any> {
  return {
    // --- Databases ---
    atlasListDatabaseConnections: (teamId: string) =>
      call('GET', `/teams/${teamId}/database-connections`).then((d: any) => d.connections ?? []),
    atlasGetDatabaseConnection: (teamId: string, connectionId: string) =>
      call('GET', `/teams/${teamId}/database-connections/${connectionId}`),
    atlasGetMongoDatabaseCatalog: (teamId: string, connectionId: string, refresh?: boolean) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/catalog`, {
          refresh,
        }),
      ),
    atlasGetMongoCollectionCatalog: (
      teamId: string,
      connectionId: string,
      database: string,
      refresh?: boolean,
    ) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/catalog/collections`, {
          database,
          refresh,
        }),
      ),
    atlasGetMongoCollectionDetail: (
      teamId: string,
      connectionId: string,
      database: string,
      collection: string,
      refresh?: boolean,
    ) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/catalog/collection`, {
          database,
          collection,
          refresh,
        }),
      ),
    atlasQueryMongoDatabase: (teamId: string, connectionId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/database-connections/${connectionId}/query/mongodb`, input),
    atlasGetMongoMonitoringHistory: (teamId: string, connectionId: string, rangeMinutes?: number) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/monitoring`, {
          rangeMinutes,
        }),
      ),
    atlasSampleMongoMonitoring: (teamId: string, connectionId: string) =>
      call('POST', `/teams/${teamId}/database-connections/${connectionId}/monitoring/sample`, {}),
    atlasListDatabaseQueryAudit: (teamId: string, connectionId: string, limit?: number) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/query/audit`, { limit }),
      ).then((d: any) => d.events ?? []),
    atlasListDatabaseChangeRequests: (teamId: string, connectionId: string, limit?: number) =>
      call(
        'GET',
        appendQuery(`/teams/${teamId}/database-connections/${connectionId}/changes`, {
          limit,
        }),
      ).then((d: any) => d.changes ?? []),
    atlasCreateDatabaseChangeRequest: (teamId: string, connectionId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/database-connections/${connectionId}/changes`, input),
    atlasUpdateDatabaseChangeRequest: (
      teamId: string,
      connectionId: string,
      changeId: string,
      patch: unknown,
    ) =>
      call(
        'PATCH',
        `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}`,
        patch,
      ),
    atlasDecideDatabaseChangeRequest: (
      teamId: string,
      connectionId: string,
      changeId: string,
      action: 'submit' | 'approve' | 'reject' | 'cancel',
      comment?: string | null,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}/${action}`,
        { comment: comment ?? null },
      ),
    atlasExecuteDatabaseChangeRequest: (
      teamId: string,
      connectionId: string,
      changeId: string,
      idempotencyKey: string,
    ) =>
      call(
        'POST',
        `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}/execute`,
        { idempotencyKey },
      ),
    atlasTestDatabaseConnectionInput: (teamId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/database-connections/test`, input),
    atlasCreateDatabaseConnection: (teamId: string, input: unknown) =>
      call('POST', `/teams/${teamId}/database-connections`, input),
    atlasUpdateDatabaseConnection: (teamId: string, connectionId: string, patch: unknown) =>
      call('PATCH', `/teams/${teamId}/database-connections/${connectionId}`, patch),
    atlasTestStoredDatabaseConnection: (teamId: string, connectionId: string) =>
      call('POST', `/teams/${teamId}/database-connections/${connectionId}/test`, {}),
    atlasDeleteDatabaseConnection: (teamId: string, connectionId: string) =>
      call('DELETE', `/teams/${teamId}/database-connections/${connectionId}`),
    // --- Cloudflare KV ---
    atlasListCloudflareKvNamespaces: (teamId: string, accountId: string) =>
      call('GET', `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces`).then(
        (d: any) => d.namespaces ?? [],
      ),
    atlasCreateCloudflareKvNamespace: (teamId: string, accountId: string, title: string) =>
      call('POST', `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces`, { title }),
    atlasRenameCloudflareKvNamespace: (
      teamId: string,
      accountId: string,
      namespaceId: string,
      title: string,
    ) =>
      call(
        'PUT',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
          namespaceId,
        )}`,
        { title },
      ),
    atlasDeleteCloudflareKvNamespace: (teamId: string, accountId: string, namespaceId: string) =>
      call(
        'DELETE',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
          namespaceId,
        )}`,
      ),
    atlasListCloudflareKvKeys: (
      teamId: string,
      accountId: string,
      namespaceId: string,
      prefix?: string,
      cursor?: string | null,
    ) =>
      call(
        'GET',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
            namespaceId,
          )}/keys`,
          { prefix: prefix || undefined, cursor: cursor || undefined },
        ),
      ),
    atlasReadCloudflareKvValue: (
      teamId: string,
      accountId: string,
      namespaceId: string,
      key: string,
    ) =>
      call(
        'GET',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
            namespaceId,
          )}/values`,
          { key },
        ),
      ),
    atlasWriteCloudflareKvValue: (
      teamId: string,
      accountId: string,
      namespaceId: string,
      input: unknown,
    ) =>
      call(
        'PUT',
        `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
          namespaceId,
        )}/values`,
        input,
      ),
    atlasDeleteCloudflareKvValue: (
      teamId: string,
      accountId: string,
      namespaceId: string,
      key: string,
    ) =>
      call(
        'DELETE',
        appendQuery(
          `/teams/${teamId}/cloudflare-accounts/${accountId}/kv/namespaces/${encodeURIComponent(
            namespaceId,
          )}/values`,
          { key },
        ),
      ),
  }
}
