import assert from 'node:assert/strict'
import test from 'node:test'

import { persistentCredentialCommand } from './persistentCredential.ts'

test('prints a persistent ServiceAccount kubeconfig instead of a temporary TokenRequest', () => {
  const command = persistentCredentialCommand('acme-dc1')

  assert.match(command, /kubernetes\.io\/service-account-token/)
  assert.match(command, /server: https:\/\/kubernetes\.default\.svc/)
  assert.match(command, /current-context: acme-dc1/)
  assert.match(command, /ServiceAccount token was not issued/)
  assert.doesNotMatch(command, /kubectl create token/)
  assert.doesNotMatch(command, /--duration=/)
})

test('grants the credential complete Kubernetes access for Nuphos features', () => {
  const command = persistentCredentialCommand('acme-dc1')

  assert.match(command, /clusterrolebinding nuphos-cluster-admin/)
  assert.match(command, /--clusterrole=cluster-admin/)
  assert.match(command, /--serviceaccount=nuphos-relay:nuphos/)
  assert.doesNotMatch(command, /--clusterrole=view/)
})
