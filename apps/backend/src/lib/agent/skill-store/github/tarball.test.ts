import { describe, expect, test } from 'bun:test'

import { repoTarball } from '@/lib/test/repo-tarball'

import { readRepoTarball, TARBALL_LIMITS } from './tarball'

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

  test('refuses a deep tree up front instead of indexing it', () => {
    const deep = Array.from({ length: 1024 }, (_, i) => `d${String(i % 10)}`).join('/')
    const archive = repoTarball(
      Array.from({ length: 1000 }, (_, i) => ({ path: `${deep}/f${String(i)}` })),
    )
    const started = performance.now()

    expect(() => readRepoTarball(archive)).toThrow(/nested too deeply/)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('accepts paths up to the depth limit and refuses longer ones', () => {
    const at = (depth: number) => `${Array.from({ length: depth }, () => 'd').join('/')}/SKILL.md`

    expect(
      readRepoTarball(repoTarball([{ path: at(TARBALL_LIMITS.pathDepth - 1) }])).files.size,
    ).toBe(1)
    expect(() => readRepoTarball(repoTarball([{ path: at(TARBALL_LIMITS.pathDepth) }]))).toThrow(
      /nested too deeply/,
    )
    expect(() => readRepoTarball(repoTarball([{ path: 'x'.repeat(5000) }]))).toThrow(/too long/)
  })

  test('rejects input that is not gzip', () => {
    expect(() => readRepoTarball(new TextEncoder().encode('not a tarball'))).toThrow(/gzip/)
  })
})
