import { Hono } from 'hono'

import { registerOnpremEnrolmentRoutes } from '@/routes/onprem-clusters/enrolment'
import { registerOnpremStatusRoutes } from '@/routes/onprem-clusters/status'

import type { TeamAuthVariables } from '@/middleware/auth'

/**
 * Enrolment for Kubernetes clusters that only exist inside a customer's network.
 * There is no cloud API to call and nothing to enumerate: they hand us a
 * kubeconfig whose server address is internal, we hand them a token and a
 * manifest for the outbound-only agent pod (apps/kube-relay-agent), and every
 * request afterwards goes through the relay's CONNECT proxy.
 */
export const onpremClustersRoutes = new Hono<{ Variables: TeamAuthVariables }>()

registerOnpremEnrolmentRoutes(onpremClustersRoutes)
registerOnpremStatusRoutes(onpremClustersRoutes)
