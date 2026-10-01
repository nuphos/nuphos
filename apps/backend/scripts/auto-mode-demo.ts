// Local demo of the Auto Mode authorization engine — no server, no Mongo.
// Runs the real layered decision over a corpus of commands and prints the
// verdict + which layer decided. The LLM judge runs only when Bedrock creds
// are configured (AWS_BEDROCK_* / AGENT_AUTO_MODE_JUDGE_MODEL_ID); otherwise
// non-read-only, non-catastrophic commands fall to the default_write layer.
//
//   bun scripts/auto-mode-demo.ts
//   bun scripts/auto-mode-demo.ts "kubectl scale deploy/api --replicas=5"
//
import { config } from '@/config'
import { analyzeCommand } from '@/lib/agent/auto-mode/command-analysis'
import { decideAuthorization } from '@/lib/agent/auto-mode/decision'
import { makeBedrockJudge } from '@/lib/agent/auto-mode/judge'
import { EMPTY_POLICY } from '@/lib/agent/auto-mode/types'

import type { AutoModePolicy } from '@/lib/agent/auto-mode/types'

const SAMPLES = [
  'kubectl get pods -n staging',
  'kubectl logs deploy/api | grep ERROR | head',
  'cd /tmp && ls -la',
  'aws ec2 describe-instances --region us-east-1',
  'kubectl rollout restart deploy/api -n staging',
  'kubectl scale deploy/api --replicas=5',
  'kubectl apply -f ingress.yaml',
  'curl -sS -H "Authorization: Bearer $TOKEN" $URL/x | python3 -m json.tool',
  'kubectl delete namespace prod',
  'terraform destroy -auto-approve',
  'rm -rf /data',
  'psql -c "SELECT count(*) FROM users"',
  'psql -c "DELETE FROM sessions WHERE expired"',
]

// A demo standing policy: the user has pre-authorized staging deploy restarts.
const POLICY: AutoModePolicy = {
  ...EMPTY_POLICY,
  rules: [
    {
      id: 'demo',
      description: 'restart a deployment in the staging namespace',
      createdBy: 'demo',
      createdAt: new Date('2026-01-01'),
    },
  ],
}

async function main() {
  const argv = process.argv.slice(2)
  const commands = argv.length ? argv : SAMPLES
  const hasCreds = !!config.agent.bedrockAccessKeyId && !!config.agent.bedrockSecretAccessKey
  const judge = hasCreds ? makeBedrockJudge({ sessionId: 'demo' }) : undefined

  console.log(
    `Auto Mode demo — judge: ${hasCreds ? config.agent.autoMode.judgeModelId : 'DISABLED (no Bedrock creds → default_write)'}`,
  )
  console.log(`Policy rule: "${POLICY.rules[0]!.description}"\n`)
  console.log('DECISION      LAYER                 COMMAND')
  console.log('─'.repeat(90))

  for (const command of commands) {
    const analysis = analyzeCommand(command)
    const v = await decideAuthorization({ enabled: true, command, policy: POLICY, judge })
    const mark = v.decision === 'allow' ? '✅ allow    ' : '🔒 auth     '
    const cmd = command.length > 46 ? `${command.slice(0, 43)}…` : command

    console.log(`${mark}  ${v.layer.padEnd(20)}  ${cmd}`)
    if (v.decision === 'require_auth') {
      const rule = v.suggestedRule ? `  [rule: ${v.suggestedRule}]` : ''

      console.log(`              ↳ ${v.reason}${rule}`)
    }
    if (analysis.opaque && v.layer !== 'catastrophic_floor') {
      // Static analysis can't see through this (pipe into interpreter, etc.),
      // so it never takes the read-only fast-path — surface that for clarity.
      console.log('              ↳ opaque: not read-only fast-pathed (judged)')
    }
  }
  process.exit(0)
}

void main()
