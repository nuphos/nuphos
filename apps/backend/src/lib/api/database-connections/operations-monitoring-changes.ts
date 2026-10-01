import { z } from 'zod'

import { databaseChangeRequestResponseSchema } from './change-schemas'
import { databaseMonitoringSampleSchema } from './monitoring-schemas'
import {
  databaseChangeDecisionSchema,
  databaseChangeExecuteSchema,
  databaseChangeRequestCreateSchema,
  databaseChangeRequestListSchema,
  databaseChangeRequestUpdateSchema,
  databaseMonitoringHistoryQuerySchema,
} from './request-schemas'
import { changePathSchema, connectionPathSchema } from './shared'

import type { ApiOperation } from '../registry'

export const databaseMonitoringAndChangeOperations = [
  {
    operationId: 'databaseMonitoring.history',
    method: 'get',
    path: '/teams/{teamId}/database-connections/{connectionId}/monitoring',
    tags: ['Databases'],
    summary: 'List MongoDB monitoring samples',
    description:
      'Returns bounded, value-only MongoDB process metrics. Credentials, query text, current operations, and raw command responses are never stored.',
    auth: 'bearer',
    pathSchema: connectionPathSchema,
    querySchema: databaseMonitoringHistoryQuerySchema,
    responseSchema: z.object({
      samples: z.array(databaseMonitoringSampleSchema),
      retentionDays: z.number().int().positive(),
    }),
  },
  {
    operationId: 'databaseMonitoring.sample',
    method: 'post',
    path: '/teams/{teamId}/database-connections/{connectionId}/monitoring/sample',
    tags: ['Databases'],
    summary: 'Collect a MongoDB monitoring sample',
    description:
      'Collects one allowlisted MongoDB metrics snapshot through the backend credential boundary. Calls are rate-limited per connection.',
    auth: 'bearer',
    pathSchema: connectionPathSchema,
    requestSchema: z.object({}).strict(),
    responseSchema: databaseMonitoringSampleSchema,
  },
  {
    operationId: 'databaseChanges.list',
    method: 'get',
    path: '/teams/{teamId}/database-connections/{connectionId}/changes',
    tags: ['Databases'],
    summary: 'List database change requests',
    description: 'Lists team-scoped MongoDB DML/DDL requests with approval and execution state.',
    auth: 'bearer',
    pathSchema: connectionPathSchema,
    querySchema: databaseChangeRequestListSchema,
    responseSchema: z.object({ changes: z.array(databaseChangeRequestResponseSchema) }),
  },
  {
    operationId: 'databaseChanges.create',
    method: 'post',
    path: '/teams/{teamId}/database-connections/{connectionId}/changes',
    tags: ['Databases'],
    summary: 'Create a database change request',
    description:
      'Encrypts an executable MongoDB statement and creates a team-scoped draft. Credentials and raw statements are never logged.',
    auth: 'bearer',
    pathSchema: connectionPathSchema,
    requestSchema: databaseChangeRequestCreateSchema,
    responseSchema: databaseChangeRequestResponseSchema,
  },
  {
    operationId: 'databaseChanges.get',
    method: 'get',
    path: '/teams/{teamId}/database-connections/{connectionId}/changes/{changeId}',
    tags: ['Databases'],
    summary: 'Get a database change request',
    description:
      'Returns a sanitized statement preview, approval state, authorized executors, and audit timeline.',
    auth: 'bearer',
    pathSchema: changePathSchema,
    responseSchema: databaseChangeRequestResponseSchema,
  },
  {
    operationId: 'databaseChanges.update',
    method: 'patch',
    path: '/teams/{teamId}/database-connections/{connectionId}/changes/{changeId}',
    tags: ['Databases'],
    summary: 'Update a draft database change request',
    description:
      'Only the requester can edit a draft. Execution semantics are immutable after submission.',
    auth: 'bearer',
    pathSchema: changePathSchema,
    requestSchema: databaseChangeRequestUpdateSchema,
    responseSchema: databaseChangeRequestResponseSchema,
  },
  ...(['submit', 'approve', 'reject', 'cancel'] as const).map((action) => ({
    operationId: `databaseChanges.${action}`,
    method: 'post' as const,
    path: `/teams/{teamId}/database-connections/{connectionId}/changes/{changeId}/${action}`,
    tags: ['Databases'],
    summary: `${action[0]!.toUpperCase()}${action.slice(1)} a database change request`,
    description:
      action === 'approve'
        ? 'Records one distinct team-member approval. Approval does not grant execution authority or execute the request.'
        : action === 'submit'
          ? 'Submits the immutable statement digest for team approval.'
          : action === 'reject'
            ? 'Rejects the pending request without executing it.'
            : 'Cancels a draft, pending, or approved request without executing it.',
    auth: 'bearer' as const,
    pathSchema: changePathSchema,
    requestSchema: databaseChangeDecisionSchema,
    responseSchema: databaseChangeRequestResponseSchema,
  })),
  {
    operationId: 'databaseChanges.execute',
    method: 'post',
    path: '/teams/{teamId}/database-connections/{connectionId}/changes/{changeId}/execute',
    tags: ['Databases'],
    summary: 'Execute an approved database change request',
    description:
      'Only an explicitly authorized executor can claim and execute the approved immutable statement through the backend gateway.',
    auth: 'bearer',
    pathSchema: changePathSchema,
    requestSchema: databaseChangeExecuteSchema,
    responseSchema: databaseChangeRequestResponseSchema,
  },
] satisfies readonly ApiOperation[]
