// Behavioral tests for the sandbox-side kubectl credential scripts, driven
// through a curl shim so no network or backend is involved. PATH is pinned to
// the shim + system dirs so results don't depend on a kubectl on the dev box.
import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const scriptsDir = path.dirname(new URL(import.meta.url).pathname)
const getCredential = path.join(scriptsDir, 'get-credential.sh')
const syncClusters = path.join(scriptsDir, 'sync-clusters.sh')

let home: string
let shim: string
let callLog: string
let argLog: string

function writeCurlShim(body: string, httpCode: string): void {
  writeFileSync(
    path.join(shim, 'curl'),
    `#!/usr/bin/env bash
out=""
url=""
printf '%s\\n' "$*" >> "${argLog}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|-H|--connect-timeout|--max-time) shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "${callLog}"
cat > "$out" <<'BODY'
${body}
BODY
printf '%s' "${httpCode}"
`,
    { mode: 0o755 },
  )
}

function installKubectlMergeShim(): void {
  writeFileSync(
    path.join(shim, 'kubectl'),
    `#!/usr/bin/env bash
if [ "$*" = "config get-contexts" ]; then
  exit 0
fi
if [ "$*" != "config view --flatten" ]; then
  echo "unexpected kubectl arguments: $*" >&2
  exit 2
fi
IFS=: read -r incoming current <<EOF
\${KUBECONFIG}
EOF
cat "$incoming" "$current"
`,
    { mode: 0o755 },
  )
}

function run(script: string, args: string[]) {
  const proc = Bun.spawnSync(['bash', script, ...args], {
    env: {
      HOME: home,
      PATH: `${shim}:/usr/bin:/bin`,
      NUPHOS_TOKEN: 'test-token',
      NUPHOS_SESSION_ID: 'sess-1',
      NUPHOS_BACKEND_URL: 'https://backend.test',
    },
  })
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

function callCount(): number {
  if (!existsSync(callLog)) return 0
  return readFileSync(callLog, 'utf-8').trim().split('\n').filter(Boolean).length
}

const CRED_BODY = JSON.stringify({
  apiVersion: 'client.authentication.k8s.io/v1',
  kind: 'ExecCredential',
  status: { token: 'k8s-aws-v1.abc', expirationTimestamp: '2099-01-01T00:00:00.000Z' },
})

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'kubectl-scripts-home-'))
  shim = mkdtempSync(path.join(tmpdir(), 'kubectl-scripts-shim-'))
  callLog = path.join(shim, 'calls.log')
  argLog = path.join(shim, 'args.log')
})

describe('get-credential.sh', () => {
  test('fetches, prints, and caches an ExecCredential', () => {
    writeCurlShim(CRED_BODY, '200')
    const first = run(getCredential, ['aws', 'team1', '123456789012', 'prod', 'us-east-1'])
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout).status.token).toBe('k8s-aws-v1.abc')
    expect(readFileSync(callLog, 'utf-8')).toContain(
      'https://backend.test/teams/team1/aws-accounts/123456789012/clusters/prod/exec-credential?region=us-east-1',
    )

    const second = run(getCredential, ['aws', 'team1', '123456789012', 'prod', 'us-east-1'])
    expect(second.exitCode).toBe(0)
    expect(JSON.parse(second.stdout).status.token).toBe('k8s-aws-v1.abc')
    expect(callCount()).toBe(1)
  })

  test('re-fetches once the cached credential nears expiry', () => {
    writeCurlShim(CRED_BODY, '200')
    run(getCredential, ['gcp', 'team1', 'my-project', 'staging', 'us-central1'])
    expect(callCount()).toBe(1)

    const expFile = path.join(
      home,
      '.kube/nuphos-cred-cache/gcp-my-project-staging-us-central1.expires',
    )
    writeFileSync(expFile, `${Math.floor(Date.now() / 1000) + 30}\n`)
    run(getCredential, ['gcp', 'team1', 'my-project', 'staging', 'us-central1'])
    expect(callCount()).toBe(2)
  })

  test('caches per region, so same-named clusters never share a token', () => {
    // The kubeconfig gives same-named clusters in different regions distinct
    // contexts; a region-blind cache key would hand the second one the first
    // one's token for the rest of the TTL.
    writeCurlShim(CRED_BODY, '200')
    run(getCredential, ['aws', 'team1', '123456789012', 'web', 'us-east-1'])
    run(getCredential, ['aws', 'team1', '123456789012', 'web', 'eu-west-1'])
    expect(callCount()).toBe(2)
    const dir = path.join(home, '.kube/nuphos-cred-cache')
    expect(existsSync(path.join(dir, 'aws-123456789012-web-us-east-1.json'))).toBe(true)
    expect(existsSync(path.join(dir, 'aws-123456789012-web-eu-west-1.json'))).toBe(true)
  })

  test('403 fails loudly with do-not-retry guidance and caches nothing', () => {
    writeCurlShim('{"error":"aws_account_agent_access_denied"}', '403')
    const result = run(getCredential, ['aws', 'team1', '123456789012', 'prod', 'us-east-1'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Do NOT retry')
    expect(
      existsSync(path.join(home, '.kube/nuphos-cred-cache/aws-123456789012-prod-us-east-1.json')),
    ).toBe(false)
  })
})

describe('sync-clusters.sh', () => {
  test('writes ~/.kube/config with the skills-dir placeholder resolved', () => {
    writeCurlShim(
      [
        'apiVersion: v1',
        'kind: Config',
        'users:',
        '  - name: "aws/123456789012/prod"',
        '    user:',
        '      exec:',
        '        command: bash',
        '        args:',
        '          - "__NUPHOS_SKILLS_DIR__/kubectl/scripts/get-credential.sh"',
      ].join('\n'),
      '200',
    )
    const result = run(syncClusters, [])
    expect(result.exitCode).toBe(0)

    const config = readFileSync(path.join(home, '.kube/config'), 'utf-8')
    const skillsDir = path.dirname(path.dirname(scriptsDir))
    expect(config).toContain(`"${skillsDir}/kubectl/scripts/get-credential.sh"`)
    expect(config).not.toContain('__NUPHOS_SKILLS_DIR__')
  })

  test('--fresh asks the backend to re-issue credentials; a bad flag is rejected', () => {
    writeCurlShim('apiVersion: v1\nkind: Config', '200')
    expect(run(syncClusters, ['--fresh']).exitCode).toBe(0)
    expect(readFileSync(callLog, 'utf-8')).toContain('/kubeconfig?fresh=1')

    const bogus = run(syncClusters, ['--force'])
    expect(bogus.exitCode).toBe(2)
    expect(bogus.stderr).toContain('Usage:')
  })

  test('--onprem requests the fast database-only kubeconfig scope', () => {
    writeCurlShim('apiVersion: v1\nkind: Config', '200')
    expect(run(syncClusters, ['--onprem']).exitCode).toBe(0)
    expect(readFileSync(callLog, 'utf-8')).toContain('/kubeconfig?scope=onprem')
    expect(readFileSync(argLog, 'utf-8')).toContain('--max-time 10')
  })

  test('--onprem merges with existing cloud contexts instead of replacing them', () => {
    installKubectlMergeShim()
    writeCurlShim('cloud-context', '200')
    expect(run(syncClusters, []).exitCode).toBe(0)

    writeCurlShim('onprem-context', '200')
    expect(run(syncClusters, ['--onprem']).exitCode).toBe(0)

    const config = readFileSync(path.join(home, '.kube/config'), 'utf-8')

    expect(config).toContain('onprem-context')
    expect(config).toContain('cloud-context')
    expect(config.indexOf('onprem-context')).toBeLessThan(config.indexOf('cloud-context'))
  })

  test('204 leaves ~/.kube/config untouched and marks the session cluster-less', () => {
    writeCurlShim('', '204')
    const result = run(syncClusters, [])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('nothing to sync')
    expect(existsSync(path.join(home, '.kube/config'))).toBe(false)
    // The marker is what stops the backend's per-turn repair poke from
    // re-firing forever on a session that has nothing to sync.
    expect(existsSync(path.join(home, '.kube/.nuphos-no-clusters'))).toBe(true)
  })

  test('a later successful sync clears the cluster-less marker', () => {
    writeCurlShim('', '204')
    run(syncClusters, [])
    expect(existsSync(path.join(home, '.kube/.nuphos-no-clusters'))).toBe(true)

    writeCurlShim('apiVersion: v1\nkind: Config', '200')
    expect(run(syncClusters, []).exitCode).toBe(0)
    expect(existsSync(path.join(home, '.kube/.nuphos-no-clusters'))).toBe(false)
    expect(existsSync(path.join(home, '.kube/config'))).toBe(true)
  })
})
