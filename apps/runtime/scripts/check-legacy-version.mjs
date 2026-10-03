import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// The two repositories publish into the same image namespace. Reserve every
// legacy version, including tags whose image build has not finished yet.
export function checkLegacyVersion(version, refs) {
  const stable = /^\d+\.\d+\.\d+$/
  if (!stable.test(version)) throw new Error(`Invalid runtime version: ${version}`)
  const candidate = version.split('.').map(BigInt)
  for (const line of refs.trim().split('\n')) {
    const match = line.match(/\srefs\/tags\/v(\d+\.\d+\.\d+)$/)
    if (!match) continue
    const legacy = match[1].split('.').map(BigInt)
    const different = candidate.findIndex((part, index) => part !== legacy[index])
    if (different === -1 || candidate[different] < legacy[different]) {
      throw new Error(`Runtime ${version} must be newer than legacy v${match[1]}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const refs = execFileSync(
    'git',
    ['ls-remote', '--tags', '--refs', 'https://github.com/zeabur/nuphos-runtime.git'],
    { encoding: 'utf8', timeout: 30_000 },
  )
  checkLegacyVersion(process.argv[2], refs)
}
