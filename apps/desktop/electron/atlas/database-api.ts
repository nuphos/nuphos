import { call } from './client'

import type {
  DatabaseChangeRequest,
  DatabaseChangeRequestInput,
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseQueryAudit,
} from './database-types'

export async function listDatabaseConnections(teamId: string): Promise<DatabaseConnection[]> {
  const data = await call<{ connections: DatabaseConnection[] }>(
    'GET',
    `/teams/${teamId}/database-connections`,
    undefined,
    { timeoutMs: 60_000 },
  )

  return data.connections ?? []
}

export async function getDatabaseConnection(
  teamId: string,
  connectionId: string,
): Promise<DatabaseConnection> {
  return call<DatabaseConnection>('GET', `/teams/${teamId}/database-connections/${connectionId}`)
}

export async function listDatabaseQueryAudit(
  teamId: string,
  connectionId: string,
  limit = 100,
): Promise<DatabaseQueryAudit[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  const data = await call<{ events: DatabaseQueryAudit[] }>(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/query/audit?${String(query)}`,
  )

  return data.events ?? []
}

export async function listDatabaseChangeRequests(
  teamId: string,
  connectionId: string,
  limit = 100,
): Promise<DatabaseChangeRequest[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  const data = await call<{ changes: DatabaseChangeRequest[] }>(
    'GET',
    `/teams/${teamId}/database-connections/${connectionId}/changes?${String(query)}`,
  )

  return data.changes ?? []
}

export async function createDatabaseChangeRequest(
  teamId: string,
  connectionId: string,
  input: DatabaseChangeRequestInput,
): Promise<DatabaseChangeRequest> {
  return call('POST', `/teams/${teamId}/database-connections/${connectionId}/changes`, input, {
    retry: false,
  })
}

export async function updateDatabaseChangeRequest(
  teamId: string,
  connectionId: string,
  changeId: string,
  patch: Partial<DatabaseChangeRequestInput>,
): Promise<DatabaseChangeRequest> {
  return call(
    'PATCH',
    `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}`,
    patch,
    { retry: false },
  )
}

export async function decideDatabaseChangeRequest(
  teamId: string,
  connectionId: string,
  changeId: string,
  action: 'submit' | 'approve' | 'reject' | 'cancel',
  comment: string | null = null,
): Promise<DatabaseChangeRequest> {
  return call(
    'POST',
    `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}/${action}`,
    { comment },
    { retry: false },
  )
}

export async function executeDatabaseChangeRequest(
  teamId: string,
  connectionId: string,
  changeId: string,
  idempotencyKey: string,
): Promise<DatabaseChangeRequest> {
  return call(
    'POST',
    `/teams/${teamId}/database-connections/${connectionId}/changes/${changeId}/execute`,
    { idempotencyKey },
    { retry: false, timeoutMs: 30_000 },
  )
}

export async function testDatabaseConnectionInput(
  teamId: string,
  input: Pick<DatabaseConnectionInput, 'engine' | 'connectionUri' | 'networkMode' | 'tailscale'>,
): Promise<Pick<DatabaseConnection, 'endpoint' | 'databaseName' | 'tls' | 'health'>> {
  return call('POST', `/teams/${teamId}/database-connections/test`, input, {
    retry: false,
    timeoutMs: 30_000,
  })
}

export async function createDatabaseConnection(
  teamId: string,
  input: DatabaseConnectionInput,
): Promise<DatabaseConnection> {
  return call('POST', `/teams/${teamId}/database-connections`, input, {
    retry: false,
    timeoutMs: 30_000,
  })
}

export async function updateDatabaseConnection(
  teamId: string,
  connectionId: string,
  patch: Partial<DatabaseConnectionInput>,
): Promise<DatabaseConnection> {
  return call('PATCH', `/teams/${teamId}/database-connections/${connectionId}`, patch, {
    retry: false,
    timeoutMs: 30_000,
  })
}

export async function testStoredDatabaseConnection(
  teamId: string,
  connectionId: string,
): Promise<DatabaseConnection> {
  return call(
    'POST',
    `/teams/${teamId}/database-connections/${connectionId}/test`,
    {},
    { retry: false, timeoutMs: 30_000 },
  )
}

export async function deleteDatabaseConnection(
  teamId: string,
  connectionId: string,
): Promise<void> {
  await call('DELETE', `/teams/${teamId}/database-connections/${connectionId}`, undefined, {
    retry: false,
    timeoutMs: 60_000,
  })
}
