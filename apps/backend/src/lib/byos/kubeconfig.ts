export type KubeconfigResult = {
  kubeconfig: string
  expiresAt: Date
}

export function renderKubeconfig(opts: {
  clusterName: string
  endpoint: string
  caBase64: string
  token: string
}): string {
  return `apiVersion: v1
kind: Config
clusters:
  - name: ${opts.clusterName}
    cluster:
      server: ${opts.endpoint}
      certificate-authority-data: ${opts.caBase64}
contexts:
  - name: ${opts.clusterName}
    context:
      cluster: ${opts.clusterName}
      user: ${opts.clusterName}
current-context: ${opts.clusterName}
users:
  - name: ${opts.clusterName}
    user:
      token: ${JSON.stringify(opts.token)}
`
}
