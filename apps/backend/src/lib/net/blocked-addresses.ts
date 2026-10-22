import net from 'node:net'

import { config } from '@/config'

const blockedAddresses = new net.BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}

blockedAddresses.addAddress('::', 'ipv6')
blockedAddresses.addAddress('::1', 'ipv6')
// IPv4-mapped addresses (::ffff:a.b.c.d) need no rule of their own: BlockList
// classifies them by the embedded IPv4 address. A ::ffff:0.0.0.0/96 rule would
// match every IPv4 address. Translated forms (NAT64, 6to4, Teredo) are refused.
for (const [network, prefix] of [
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

// The cluster's Service range: its addresses are not private, so name them.
for (const cidr of config.byos.outbound.blockedCidrs) {
  const [network = '', prefix = ''] = cidr.split('/')

  blockedAddresses.addSubnet(network, Number(prefix), net.isIPv6(network) ? 'ipv6' : 'ipv4')
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)

  if (family === 4) return blockedAddresses.check(address, 'ipv4')
  if (family === 6) return blockedAddresses.check(address, 'ipv6')

  return true
}
