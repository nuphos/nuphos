import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'
import { infraCredentialOperations } from '@/lib/api/credentials/operations-infra'
import { signHuaweiRequest } from '@/lib/byos/huawei-signer'
import { QUERY_CASE, SDK_VECTORS, TOKEN_CASE } from '@/lib/byos/huawei-signer-vectors'

const huaweiDir = path.join(getBuiltinSkillsDirectory(), 'huawei')
const read = (file: string) => readFileSync(path.join(huaweiDir, file), 'utf-8')

const DRIVER = `
import importlib.util, json, sys
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location("hw_api", sys.argv[1])
hw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hw)
out = []
for case in json.load(sys.stdin):
    if case["kind"] == "query":
        out.append(hw.canonical_query(case["query"]))
    elif case["kind"] == "authorization":
        out.append(hw.authorization(case["method"], case["url"], case["headers"],
                                    case["body"].encode(), case["ak"], case["sk"]))
    else:
        now = datetime.strptime(case["date"], hw.DATE_FORMAT).replace(tzinfo=timezone.utc)
        headers, _ = hw.sign(case["method"], case["url"], "", case["ak"], case["sk"],
                             case["token"], "application/json", now=now)
        out.append(headers)
print(json.dumps(out))
`

function runHwApi(cases: unknown[]): unknown[] {
  const proc = Bun.spawnSync(['python3', '-c', DRIVER, path.join(huaweiDir, 'scripts/hw-api.py')], {
    stdin: Buffer.from(JSON.stringify(cases)),
  })

  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())

  return JSON.parse(proc.stdout.toString()) as unknown[]
}

function signWithHwApi(request: Record<string, string>): Record<string, string> {
  return runHwApi([{ kind: 'sign', ...request }])[0] as Record<string, string>
}

describe('hw-api.py signing', () => {
  test('reproduces the official Huawei SDK test vectors', () => {
    expect(runHwApi(SDK_VECTORS.map((v) => ({ kind: 'authorization', ...v })))).toEqual(
      SDK_VECTORS.map((v) => v.expected),
    )
  })

  test('builds the canonical query string of the SDK test', () => {
    const query = new URLSearchParams(QUERY_CASE.params).toString()

    expect(runHwApi([{ kind: 'query', query }])).toEqual([QUERY_CASE.expected])
  })

  test('signs a request exactly as the SDK does when it adds Host itself', () => {
    const vector = SDK_VECTORS[0]!
    const headers = signWithHwApi({
      method: vector.method,
      url: vector.url,
      ak: vector.ak,
      sk: vector.sk,
      token: '',
      date: vector.headers['X-Sdk-Date']!,
    })

    expect(headers.Authorization).toBe(vector.expected)
  })

  test('signs the security token and agrees with the backend signer', () => {
    const headers = signWithHwApi(TOKEN_CASE)
    const backend = signHuaweiRequest(
      TOKEN_CASE.method,
      new URL(TOKEN_CASE.url),
      {
        accessKeyId: TOKEN_CASE.ak,
        secretAccessKey: TOKEN_CASE.sk,
        securityToken: TOKEN_CASE.token,
      },
      undefined,
      new Date(TOKEN_CASE.isoDate),
    )

    expect(headers['X-Security-Token']).toBe(TOKEN_CASE.token)
    expect(headers.Authorization).toContain('SignedHeaders=host;x-sdk-date;x-security-token,')
    expect(headers.Authorization).toBe(backend.Authorization!)
  })
})

describe('huawei skill guidance', () => {
  test.each(['SKILL.md', 'scripts/setup-credentials.sh', 'scripts/hw-api.py'])(
    '%s never points the agent at a Huawei CLI',
    (file) => {
      expect(read(file)).not.toMatch(/KooCLI|cli-domain-id/i)
    },
  )

  test('the first documented call is the one Nuphos makes at bind time', () => {
    const bindCheck = readFileSync(
      path.join(import.meta.dir, '../../byos/huawei-trust-policy.ts'),
      'utf-8',
    )

    expect(bindCheck).toContain("const IAM_HOST = 'iam.myhuaweicloud.com'")
    expect(bindCheck).toContain('/v5/agencies`')
    expect(read('SKILL.md')).toContain(
      'python3 skills/huawei/scripts/hw-api.py GET "https://iam.myhuaweicloud.com/v5/agencies?limit=1"',
    )
  })

  test('the credentials API describes the tools that actually consume it', () => {
    const operation = infraCredentialOperations.find(
      (op) => op.operationId === 'teams.huaweiCredentials.get',
    )

    expect(operation?.description).toContain("huawei skill's hw-api.py")
    expect(operation?.description).not.toContain('hcloud')
  })

  test('answers "can you see my binding" without a live call', () => {
    expect(read('SKILL.md')).toMatch(/Answer from `list_credentials`[^\n]* alone/)
  })
})
