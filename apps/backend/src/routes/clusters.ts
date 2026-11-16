import { Hono } from 'hono'

import { listClustersForTeam } from '@/lib/byos'
import { parseObjectId } from '@/lib/objectid'
import { canRequestUseBinding } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { BindingAccess, TeamByosBindings } from '@/models'
import type { Context } from 'hono'

export const teamClusters = new Hono<{ Variables: TeamAuthVariables }>()

/** The team's bindings this request may use, so private ones never list their clusters. */
export function usableClusterBindings(
  c: Context,
  doc: TeamByosBindings | null,
): TeamByosBindings | null {
  if (!doc) return null
  const usable = <T extends { access?: BindingAccess }>(list: T[] | undefined) =>
    (list ?? []).filter((binding) => canRequestUseBinding(c, binding.access))

  return {
    ...doc,
    awsRoles: usable(doc.awsRoles),
    gcpServiceAccounts: usable(doc.gcpServiceAccounts),
    tencentAccounts: usable(doc.tencentAccounts),
    aliyunAccounts: usable(doc.aliyunAccounts),
    volcengineAccounts: usable(doc.volcengineAccounts),
    azureAccounts: usable(doc.azureAccounts),
  }
}

teamClusters.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne({ _id: teamId })

  return c.json(await listClustersForTeam(usableClusterBindings(c as Context, doc)))
})
