import { randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { clearAgentClusterContextCache } from '@/lib/byos/agent-kubeconfig/collect'
import { relayConfigured } from '@/lib/byos/relay-token'
import { encryptOnpremKubeconfig } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import {
  appendCluster,
  installPayload,
  loadBinding,
  parseKubeconfigOrFail,
  publicView,
  requireRelay,
} from '@/routes/onprem-clusters/shared'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { OnpremClusterBinding } from '@/models'
import type { Hono } from 'hono'

const enrolSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        'Label must be lowercase letters, digits and dashes — it becomes part of the kubectl context name.',
      ),
    // Optional on purpose: enrolment is tunnel-first, so the agent can be
    // installed and watched connecting before any credential changes hands.
    kubeconfig: z
      .string()
      .min(1)
      .max(256 * 1024)
      .optional(),
  })
  .strict()

const kubeconfigSchema = z
  .object({
    kubeconfig: z
      .string()
      .min(1)
      .max(256 * 1024),
  })
  .strict()

export function registerOnpremEnrolmentRoutes(
  onpremClustersRoutes: Hono<{ Variables: TeamAuthVariables }>,
) {
  onpremClustersRoutes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { onpremClusters: 1 } },
    )

    return c.json({
      clusters: (doc?.onpremClusters ?? []).map(publicView),
      relayConfigured: relayConfigured(),
    })
  })

  onpremClustersRoutes.post(
    '/',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', enrolSchema),
    async (c) => {
      requireRelay()
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const { label, kubeconfig } = c.req.valid('json')

      // One enrolled cluster is one environment — unlike a cloud binding,
      // which exposes however many clusters the provider has.

      const credential = kubeconfig ? parseKubeconfigOrFail(kubeconfig) : null

      const now = new Date()
      const binding: OnpremClusterBinding = {
        id: new ObjectId(),
        label,
        clusterKey: randomBytes(16).toString('hex'),
        ...(credential
          ? {
              endpoint: credential.endpoint,
              encryptedKubeconfig: encryptOnpremKubeconfig(kubeconfig!),
            }
          : {}),
        createdAt: now,
        tokenIssuedAt: now,
        access: createDefaultAccess(c.get('userId'), now),
      }

      if (!(await appendCluster(teamId, binding, now))) {
        throw new AppError(
          409,
          'onprem_cluster_label_taken',
          `This team already has an on-prem cluster labelled "${label}".`,
        )
      }

      return c.json(
        { cluster: publicView(binding), install: installPayload(binding.clusterKey) },
        201,
      )
    },
  )

  onpremClustersRoutes.put(
    '/:clusterId/kubeconfig',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', kubeconfigSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const binding = await loadBinding(teamId, c.req.param('clusterId'))
      const { kubeconfig } = c.req.valid('json')
      const { endpoint } = parseKubeconfigOrFail(kubeconfig)

      const now = new Date()
      const encryptedKubeconfig = encryptOnpremKubeconfig(kubeconfig)

      await teamByosBindings().updateOne(
        { _id: teamId, 'onpremClusters.id': binding.id },
        {
          $set: {
            'onpremClusters.$.endpoint': endpoint,
            'onpremClusters.$.encryptedKubeconfig': encryptedKubeconfig,
            updatedAt: now,
          },
        },
      )
      clearAgentClusterContextCache()

      return c.json({ cluster: publicView({ ...binding, endpoint, encryptedKubeconfig }) })
    },
  )

  /**
   * Rotation re-keys the cluster: new sessions are issued tokens for the new key,
   * and a token carrying the old key can no longer reach anything the new key
   * parks.
   *
   * It is NOT an instant cut-off, and should not be described as one. The relay
   * authorises statelessly by HMAC and expiry, with no revocation list, so until
   * the customer updates the Secret and restarts the pod their agent keeps parking
   * connections under the OLD key, and session tokens already issued (up to 12h)
   * keep routing through them. What is instant is the customer's own kill switch —
   * scaling the Deployment to zero — which is the honest answer to "cut it off
   * right now". Relay-side revocation would need state the relay deliberately does
   * not have today.
   */
  onpremClustersRoutes.post(
    '/:clusterId/rotate-token',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      requireRelay()
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const clusterId = c.req.param('clusterId')
      const binding = await loadBinding(teamId, clusterId)

      const clusterKey = randomBytes(16).toString('hex')
      const now = new Date()

      await teamByosBindings().updateOne(
        { _id: teamId, 'onpremClusters.id': binding.id },
        {
          $set: {
            'onpremClusters.$.clusterKey': clusterKey,
            'onpremClusters.$.tokenIssuedAt': now,
            updatedAt: now,
          },
        },
      )

      return c.json({ install: installPayload(clusterKey) })
    },
  )

  onpremClustersRoutes.delete('/:clusterId', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const clusterId = c.req.param('clusterId')
    const binding = await loadBinding(teamId, clusterId)

    await teamByosBindings().updateOne(
      { _id: teamId },
      { $pull: { onpremClusters: { id: binding.id } }, $set: { updatedAt: new Date() } },
    )

    return c.json({ deleted: true })
  })
}
