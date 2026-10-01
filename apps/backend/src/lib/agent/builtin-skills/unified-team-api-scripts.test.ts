import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const providers = [
  'aliyun',
  'asana',
  'aws',
  'azure',
  'betterstack',
  'cloudflare',
  'gcloud',
  'hetzner',
  'huawei',
  'jira',
  'linear',
  'linode',
  'posthog',
  'resend',
  'sentry',
  'tailscale',
  'tencent',
  'volcengine',
  'zeabur',
]

describe('provider semantic scripts', () => {
  test('use one ordinary team API URL for user and conversation principals', async () => {
    for (const provider of providers) {
      const source = await Bun.file(
        join(getBuiltinSkillsDirectory(), provider, 'scripts', 'setup-credentials.sh'),
      ).text()

      expect(source, provider).toMatch(/\/teams\/\$\{team_(?:id|enc)\}\//u)
      expect(source, provider).not.toContain('/agent-sessions/')
    }
  })
})
