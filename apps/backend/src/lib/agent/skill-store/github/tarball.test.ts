import { describe, expect, test } from 'bun:test'

import { repoTarball } from '@/lib/test/repo-tarball'

import { readRepoTarball } from './tarball'

const sha = 'a'.repeat(40)
const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data)

describe('readRepoTarball', () => {
  test('reads the commit id, strips the root folder and keeps long paths', () => {
    const long = `skills/${'d'.repeat(120)}/SKILL.md`
    const archive = readRepoTarball(
      repoTarball(
        [
          { path: 'README.md', content: 'hello' },
          { path: 'skills/', type: '5' },
          { path: long, content: 'long' },
        ],
        { commitSha: sha },
      ),
    )

    expect(archive.commitSha).toBe(sha)
    expect([...archive.files.keys()]).toEqual(['README.md', long])
    expect(text(archive.files.get(long))).toBe('long')
  })

  test('skips links instead of following them', () => {
    const archive = readRepoTarball(
      repoTarball([
        { path: 'skills/a/SKILL.md', content: 'x' },
        { path: 'skills/a/secret', type: '2', link: '/etc/passwd' },
      ]),
    )

    expect(archive.skipped).toEqual(['skills/a/secret'])
    expect(archive.files.has('skills/a/secret')).toBe(false)
  })

  test.each(['/etc/passwd', '../outside', 'repo-main/../../x'])(
    'rejects the escaping path %s',
    (path) => {
      expect(() => readRepoTarball(repoTarball([{ path, content: 'x' }]))).toThrow(/unsafe path/)
    },
  )

  test('rejects input that is not gzip', () => {
    expect(() => readRepoTarball(new TextEncoder().encode('not a tarball'))).toThrow(/gzip/)
  })
})
