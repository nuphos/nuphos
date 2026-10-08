import { defineRailway, github, project, service, volume } from 'railway/iac'
import { required, domain } from './inputs.ts'

export default defineRailway(() => {
  const password = required('RUNTIME_PASSWORD')
  if (password.length < 32) throw new Error('RUNTIME_PASSWORD must contain at least 32 characters')
  const home = volume('runtime-home', { region: 'us-west2', sizeMB: 10240 })
  const runtime = service('runtime', {
    source: github(process.env.NUPHOS_GITHUB_REPO || 'nuphos/nuphos', {
      branch: process.env.NUPHOS_GITHUB_BRANCH || 'main',
      rootDirectory: 'deploy/railway/runtime',
    }),
    replicas: 1,
    deploy: { restartPolicyType: 'ALWAYS', sleepApplication: false },
    healthcheck: '/',
    healthcheckTimeout: 300,
    domains: [{ domain: domain('RUNTIME_DOMAIN'), port: 8080 }],
    volumeMounts: { '/home/node': home },
    env: { PORT: '8080', OPENAB_ACP_AUTH_KEY: password, OPENAB_STREAM_EDIT_INTERVAL_MS: '300' },
  })
  return project('nuphos-runtime', { resources: [runtime, home] })
})
