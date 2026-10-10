import { readFileSync } from 'node:fs'
import { defineRailway, image, project, service, volume } from 'railway/iac'
import { parse } from 'yaml'
import { required, domain } from './inputs.ts'

// Use the same bootstrap scripts that Zeabur's Docker integration test exercises.
const template = parse(readFileSync(new URL('../../zeabur/template.yaml', import.meta.url), 'utf8'))
const bootstrap = (name: string, shell: string) => {
  let script = template.spec.services.find((s: { name: string }) => s.name === name).spec.configs[0]
    .template
  if (name === 'mongo') script = script.replace('mongod --replSet', 'mongod --ipv6 --replSet')
  return `${shell} -c '${script.replaceAll("'", "'\\''")}'`
}

export default defineRailway(() => {
  const apiDomain = domain('API_DOMAIN')
  const storageDomain = domain('STORAGE_DOMAIN')
  const mongoPassword = required('MONGO_PASSWORD')
  const storageSecret = required('STORAGE_SECRET')
  const mongoData = volume('mongo-data', { region: 'us-west2', sizeMB: 10240 })
  const storageData = volume('storage-data', { region: 'us-west2', sizeMB: 10240 })
  const mongo = service('mongo', {
    source: image('mongo:8.0.32'),
    start: bootstrap('mongo', '/bin/bash'),
    replicas: { 'us-west2': 1 },
    deploy: { restartPolicyType: 'ALWAYS' },
    volumeMounts: { '/data': mongoData },
    env: {
      // Stable replica identity across container replacement; clients use directConnection.
      NUPHOS_MONGO_HOST: 'localhost',
      MONGO_INITDB_ROOT_USERNAME: 'nuphos',
      MONGO_INITDB_ROOT_PASSWORD: mongoPassword,
    },
  })
  const storage = service('storage', {
    source: image('rustfs/rustfs:1.0.0'),
    start: bootstrap('rustfs', '/bin/sh'),
    replicas: { 'us-west2': 1 },
    deploy: { restartPolicyType: 'ALWAYS' },
    healthcheck: '/health',
    domains: [{ domain: storageDomain, port: 9000 }],
    volumeMounts: { '/data': storageData },
    env: {
      PORT: '9000',
      RUSTFS_ADDRESS: '[::]:9000',
      // Railway volumes are root-owned; the agent remains non-root in its own project.
      RAILWAY_RUN_UID: '0',
      RUSTFS_ACCESS_KEY: 'nuphos',
      RUSTFS_SECRET_KEY: storageSecret,
      S3_ACCESS_KEY: 'nuphos',
      S3_SECRET_KEY: storageSecret,
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      BUCKETS: 'nuphos-file-transfers nuphos-skills',
    },
  })
  const backend = service('backend', {
    source: image('ghcr.io/nuphos/backend:v0.86.0'),
    replicas: { 'us-west2': 1 },
    deploy: { restartPolicyType: 'ALWAYS' },
    healthcheck: '/health/ready',
    healthcheckTimeout: 300,
    domains: [{ domain: apiDomain, port: 3000 }],
    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      MONGODB_URI: `mongodb://nuphos:${encodeURIComponent(mongoPassword)}@\${{mongo.RAILWAY_PRIVATE_DOMAIN}}:27017/nuphos?authSource=admin&replicaSet=rs0&directConnection=true`,
      MONGODB_DB: 'nuphos',
      NUPHOS_JWT_SECRET: required('JWT_SECRET'),
      NUPHOS_AUTH_BASE_URL: `https://${apiDomain}`,
      NUPHOS_BACKEND_URL: `https://${apiDomain}`,
      NUPHOS_PUBLIC_BACKEND_URL: `https://${apiDomain}`,
      ZSEND_API_KEY: required('ZSEND_API_KEY'),
      NUPHOS_EMAIL_FROM: required('NUPHOS_EMAIL_FROM'),
      ATLAS_REDIS_ENABLED: 'false',
      CLAUDE_CODE_RUNTIME_KUBECTL: 'false',
      CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED: 'false',
      NUPHOS_FILE_TRANSFER_S3_BUCKET: 'nuphos-file-transfers',
      NUPHOS_FILE_TRANSFER_S3_REGION: 'us-east-1',
      NUPHOS_FILE_TRANSFER_S3_ENDPOINT: `https://${storageDomain}`,
      NUPHOS_FILE_TRANSFER_S3_ACCESS_KEY_ID: 'nuphos',
      NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY: storageSecret,
      ATLAS_SKILLS_BUCKET: 'nuphos-skills',
      ATLAS_SKILLS_S3_REGION: 'us-east-1',
      ATLAS_SKILLS_S3_ENDPOINT: `https://${storageDomain}`,
      ATLAS_SKILLS_S3_ACCESS_KEY_ID: 'nuphos',
      ATLAS_SKILLS_S3_SECRET_ACCESS_KEY: storageSecret,
    },
  })
  return project('nuphos-data', { resources: [mongo, storage, backend, mongoData, storageData] })
})
