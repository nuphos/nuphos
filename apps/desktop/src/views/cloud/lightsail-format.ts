import type { AwsLightsailInstance } from '../../types'

export function formatLightsailPorts(ports: AwsLightsailInstance['ports']): string {
  const publicPorts = ports.filter((p) => p.accessType?.toLowerCase() === 'public')
  const target = publicPorts.length ? publicPorts : ports
  const shown = target.slice(0, 4).map((p) => {
    const range =
      p.fromPort === p.toPort || p.toPort == null
        ? String(p.fromPort ?? '-')
        : `${String(p.fromPort ?? '-')}-${String(p.toPort)}`

    return `${p.protocol}:${range}`
  })
  const suffix = target.length > 4 ? ` (+${String(target.length - 4)} more)` : ''

  return shown.join(', ') + suffix
}
