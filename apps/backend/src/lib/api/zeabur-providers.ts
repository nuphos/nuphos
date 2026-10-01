import { z } from 'zod'

import type { ApiOperation } from './registry'

const objectIdStringSchema = z.string().regex(/^[a-f0-9]{24}$/i)
const zeaburIdStringSchema = z.string().trim().min(1).max(120)

const teamPathSchema = z.object({
  teamId: objectIdStringSchema.describe('Nuphos team id.'),
})

const zeaburProviderPathSchema = teamPathSchema.extend({
  zeaburId: zeaburIdStringSchema.describe('Bound Zeabur user or team id.'),
})

const zeaburProviderSchema = z.object({
  providerId: objectIdStringSchema,
  zeaburId: zeaburIdStringSchema,
  kind: z.enum(['user', 'team']),
  name: z.string().min(1),
  createdAt: z.string().datetime().optional(),
})

const zeaburProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().nullable(),
  region: z.string().nullable(),
  createdAt: z.string().nullable(),
})

const zeaburServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().nullable(),
  region: z.string().nullable(),
  createdAt: z.string().nullable(),
  ip: z.string().nullable(),
  sshPort: z.number().nullable(),
  sshUsername: z.string().nullable(),
  isOnline: z.boolean().nullable(),
  vmStatus: z.string().nullable(),
  sshAvailable: z.boolean().nullable(),
  latency: z.number().nullable(),
  totalCPU: z.number().nullable(),
  usedCPU: z.number().nullable(),
  totalMemory: z.number().nullable(),
  usedMemory: z.number().nullable(),
  totalDisk: z.number().nullable(),
  usedDisk: z.number().nullable(),
  warnings: z.array(z.string()),
})

const zeaburProvidersResponseSchema = z.object({
  providers: z.array(zeaburProviderSchema),
})

const zeaburProjectsResponseSchema = z.object({
  projects: z.array(zeaburProjectSchema),
})

const zeaburServersResponseSchema = z.object({
  servers: z.array(zeaburServerSchema),
})

export const zeaburProviderApiOperations = [
  {
    operationId: 'teams.zeaburProviders.list',
    method: 'get',
    path: '/teams/{teamId}/zeabur-providers',
    tags: ['Zeabur providers'],
    summary: 'List bound Zeabur providers',
    description:
      'List Zeabur user and team identities connected to a Nuphos team without returning raw provider credentials.',
    auth: 'bearer',
    pathSchema: teamPathSchema,
    responseSchema: zeaburProvidersResponseSchema,
  },
  {
    operationId: 'teams.zeaburProjects.list',
    method: 'get',
    path: '/teams/{teamId}/zeabur-providers/{zeaburId}/projects',
    tags: ['Zeabur providers'],
    summary: 'List Zeabur projects',
    description:
      'List projects visible through a bound Zeabur provider. This route proxies Zeabur data and does not expose the underlying Zeabur token.',
    auth: 'bearer',
    pathSchema: zeaburProviderPathSchema,
    responseSchema: zeaburProjectsResponseSchema,
  },
  {
    operationId: 'teams.zeaburServers.list',
    method: 'get',
    path: '/teams/{teamId}/zeabur-providers/{zeaburId}/servers',
    tags: ['Zeabur providers'],
    summary: 'List Zeabur servers',
    description:
      'List servers visible through a bound Zeabur provider, including safe diagnostics such as IP, VM status, SSH availability, resource usage, and warnings.',
    auth: 'bearer',
    pathSchema: zeaburProviderPathSchema,
    responseSchema: zeaburServersResponseSchema,
  },
] as const satisfies readonly ApiOperation[]
