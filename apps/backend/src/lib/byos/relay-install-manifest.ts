import { config } from '@/config'

/**
 * The install manifest handed to a customer when they enrol an on-prem cluster:
 * a namespace, the Secret holding their enrolment token, and the Deployment of
 * the outbound-only agent pod.
 *
 * Kept byte-identical to `apps/kube-relay-agent/deploy/nuphos-relay-agent.yaml`
 * (the reference copy for a manual install) — the backend image does not ship
 * that app's files, so the text lives here too and
 * relay-install-manifest.test.ts fails if the two drift apart.
 */
const INSTALL_MANIFEST_TEMPLATE = `# Nuphos relay agent — the whole install.
#
# What this creates: one namespace, one Secret holding the token Nuphos issued
# you, and one Deployment of two small pods. No Service, no Ingress, no
# NodePort, no privileges, no host mounts, no inbound port of any kind — the
# pods only make outbound TLS connections to the Nuphos relay.
#
# Enrolling a cluster in Nuphos hands you this file with the three values below
# already filled in. Installing by hand instead? Replace each of the three
# PLACEHOLDER values with the relay endpoint, enrolment token (treat it as a
# secret) and image digest shown on the cluster's page.
#
# To revoke our access at any time, without asking us:
#   kubectl -n nuphos-relay scale deploy/nuphos-relay-agent --replicas=0
#
# To bound what we can reach, apply networkpolicy-example.yaml (edited for your
# cluster) — that policy, and the RBAC on whichever ServiceAccount you issued
# the kubeconfig for, are the only things that decide it. The agent itself
# enforces nothing.
apiVersion: v1
kind: Namespace
metadata:
  name: nuphos-relay
---
apiVersion: v1
kind: Secret
metadata:
  name: nuphos-relay-agent
  namespace: nuphos-relay
type: Opaque
stringData:
  token: RELAY_TOKEN_PLACEHOLDER
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nuphos-relay-agent
  namespace: nuphos-relay
  labels:
    app.kubernetes.io/name: nuphos-relay-agent
spec:
  # Two replicas purely for continuity across node drains and rolling updates.
  # Every connection either replica parks is interchangeable to the relay, so
  # this is not a leader/follower arrangement and needs no coordination.
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: nuphos-relay-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: nuphos-relay-agent
    spec:
      # The tunnel needs no Kubernetes API access of its own. The credential the
      # Nuphos agent uses is the one in the kubeconfig you handed over, and its
      # permissions are that ServiceAccount's RBAC — not this pod's.
      automountServiceAccountToken: false
      # In-flight work (a kubectl exec, a long watch) is allowed to drain; the
      # connection pool stops accepting new streams as soon as SIGTERM lands.
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent
          image: IMAGE_PLACEHOLDER
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            privileged: false
            capabilities:
              drop: ['ALL']
          env:
            - name: NUPHOS_RELAY_ENDPOINT
              value: RELAY_ENDPOINT_PLACEHOLDER
            - name: NUPHOS_RELAY_TOKEN
              valueFrom:
                secretKeyRef:
                  name: nuphos-relay-agent
                  key: token
            # Uncomment if this cluster reaches the internet only through a proxy.
            # The agent uses the standard variables, so NO_PROXY works too.
            # - name: HTTPS_PROXY
            #   value: http://egress.corp.internal:3128
          resources:
            requests:
              cpu: 10m
              memory: 32Mi
            limits:
              cpu: 200m
              memory: 128Mi
`

export function renderRelayInstallManifest(opts: {
  agentEndpoint: string
  agentToken: string
  agentImage?: string
}): string {
  const image = opts.agentImage ?? config.relay.agentImage

  if (!image) {
    // Unreachable through the routes, which gate on relayConfigured(); explicit
    // so a future caller cannot render a manifest with a blank image.
    throw new Error('NUPHOS_RELAY_AGENT_IMAGE is required to render an install manifest')
  }

  return INSTALL_MANIFEST_TEMPLATE.replaceAll('RELAY_ENDPOINT_PLACEHOLDER', opts.agentEndpoint)
    .replaceAll('RELAY_TOKEN_PLACEHOLDER', opts.agentToken)
    .replaceAll('IMAGE_PLACEHOLDER', image)
}
