import { z } from 'zod'

import { firebaseAppsSchema, firebaseProjectSchema } from './firebase-schemas'
import { gcpProjectPathSchema, objectIdStringSchema } from './paths'

import type { ApiOperation } from '../registry'

const selection = z.object({ serviceAccountId: objectIdStringSchema.optional() })

export const firebaseOperations = [
  {
    operationId: 'teams.gcpFirebase.project',
    method: 'get',
    path: '/teams/{teamId}/gcp-projects/{projectId}/firebase/project',
    tags: ['Google Cloud Firebase'],
    summary: 'Inspect the bound Firebase project',
    description:
      'Uses the selected ordinary GCP binding. Does not enable Firebase or APIs. Errors do not prove Firebase is disabled.',
    auth: 'bearer',
    pathSchema: gcpProjectPathSchema,
    querySchema: selection,
    responseSchema: firebaseProjectSchema,
  },
  {
    operationId: 'teams.gcpFirebase.apps',
    method: 'get',
    path: '/teams/{teamId}/gcp-projects/{projectId}/firebase/apps',
    tags: ['Google Cloud Firebase'],
    summary: 'List registered Firebase apps',
    description:
      'One bounded page of app metadata; does not return API keys or app configuration. Pass nextPageToken to continue.',
    auth: 'bearer',
    pathSchema: gcpProjectPathSchema,
    querySchema: selection.extend({ pageToken: z.string().max(4096).optional() }),
    responseSchema: firebaseAppsSchema,
  },
] as const satisfies readonly ApiOperation[]
