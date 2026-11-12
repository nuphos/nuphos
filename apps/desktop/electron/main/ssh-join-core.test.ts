import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  sshBinary,
  sshConfigHosts,
  sshJoinDevice,
  sshJoinArgs,
  sshJoinProblem,
  sshJoinScript,
} from './ssh-join-core.ts'

const home = '/home/me'

function hostsFrom(files: Record<string, string>) {
  return sshConfigHosts(join(home, '.ssh/config'), {
    home,
    read: (path) => files[path] ?? null,
    list: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1)),
  })
}

test('lists concrete Host aliases with their first HostName and User, following Include', () => {
  const hosts = hostsFrom({
    '/home/me/.ssh/config': [
      '# work',
      'Include config.d/*',
      'Host build build-alt',
      '  HostName build.lan',
      '  User ubuntu',
      '  HostName ignored',
      'Host *.internal !bastion',
      '  User nobody',
      'Match host db',
      '  User postgres',
      'Host = "studio"',
      '  user = me',
    ].join('\n'),
    '/home/me/.ssh/config.d/b': 'Host gpu\n  HostName gpu.lan',
    '/home/me/.ssh/config.d/a': 'Host pi\r\n  User pi\r\n',
  })

  assert.deepEqual(hosts, [
    { alias: 'pi', user: 'pi' },
    { alias: 'gpu', hostName: 'gpu.lan' },
    { alias: 'build', hostName: 'build.lan', user: 'ubuntu' },
    { alias: 'build-alt', hostName: 'build.lan', user: 'ubuntu' },
    { alias: 'studio', user: 'me' },
  ])
})

test('a missing config or an Include loop lists what it can', () => {
  assert.deepEqual(hostsFrom({}), [])
  assert.deepEqual(hostsFrom({ '/home/me/.ssh/config': 'Include ~/.ssh/config\nHost a' }), [
    { alias: 'a' },
  ])
})

test('ssh runs without prompts, with a port when given, and never reads the target as an option', () => {
  assert.deepEqual(sshJoinArgs(' me@box.lan:2222 '), [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-p',
    '2222',
    '--',
    'me@box.lan',
    'sh -s',
  ])
  assert.equal(sshJoinArgs('build')?.at(-2), 'build')
  assert.equal(sshJoinArgs('-oProxyCommand=x'), null)
  assert.equal(sshJoinArgs('a b'), null)
})

test('the script starts the agent in the background with the token from stdin', () => {
  const script = sshJoinScript({ token: 'nj_1', apiUrl: 'https://api.dev' })

  assert.match(
    script,
    /curl -fsSL https:\/\/nuphos.ai\/install \| PATH="\$HOME\/.local\/bin:\$PATH" sh/,
  )
  assert.match(
    script,
    /NUPHOS_API_URL='https:\/\/api.dev' NUPHOS_JOIN_TOKEN='nj_1' nohup "\$HOME\/.local\/bin\/nuphos" agent .*&\n/,
  )
  assert.doesNotMatch(sshJoinScript({ token: 'nj_1', apiUrl: 'https://api.nuphos.ai' }), /API_URL/)
  // An agent that exits without joining fails the run with its log, instead of a silent wait;
  // one that installed the systemd service exits once it joined.
  assert.match(
    script,
    /\[ -s "\$cred" \] \|\| kill -0 \$agent 2>\/dev\/null \|\| \{ cat "\$HOME\/.nuphos-agent.log" >&2; exit 1; \}/,
  )
  // It names the computer it joined, so Desktop waits for that one.
  assert.match(script, /device-credential\.json[\s\S]*"deviceId"[\s\S]*Device: /)
  // A credential still missing after the wait leaves the id out instead of failing the run.
  assert.match(script, /Device: [^\n]*"\$cred" 2>\/dev\/null \|\| true\n/)
  assert.throws(() => sshJoinScript({ token: "x'; rm -rf ~", apiUrl: null }))
})

test('failures are told apart by what ssh wrote', () => {
  assert.equal(sshJoinProblem(255, 'Host key verification failed.\r\n'), 'host-key')
  assert.equal(sshJoinProblem(255, 'me@box: Permission denied (publickey).'), 'auth')
  assert.equal(sshJoinProblem(255, 'ssh: Could not resolve hostname box'), 'unreachable')
  assert.equal(sshJoinProblem(1, 'The Nuphos CLI did not install.'), 'failed')
  assert.equal(sshJoinProblem(1, 'mkdir: /opt/x: Permission denied'), 'failed')
})

test('the system ssh, wherever OpenSSH puts it', () => {
  assert.equal(sshBinary('darwin'), '/usr/bin/ssh')
  assert.equal(sshBinary('win32', 'D:\\Win'), 'D:\\Win\\System32\\OpenSSH\\ssh.exe')
})

test('the joined computer is the id the script printed', () => {
  assert.equal(
    sshJoinDevice('Installed nuphos\nStarted.\nDevice: b6b2bd58-fd01-4414\n'),
    'b6b2bd58-fd01-4414',
  )
  assert.equal(sshJoinDevice('Started.\n'), null)
})
