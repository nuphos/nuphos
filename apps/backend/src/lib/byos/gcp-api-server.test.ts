import { describe, expect, test } from 'bun:test'

import { gkeApiServer } from './gcp'

const ipCluster = {
  endpoint: '34.1.2.3',
  masterAuth: { clusterCaCertificate: 'R0NQLUNB' },
}

describe('gkeApiServer', () => {
  test('prefers the DNS endpoint when it accepts external traffic', () => {
    expect(
      gkeApiServer({
        ...ipCluster,
        controlPlaneEndpointsConfig: {
          dnsEndpointConfig: {
            endpoint: 'gke-abc-123.us-west1-a.gke.goog',
            allowExternalTraffic: true,
          },
        },
      }),
    ).toEqual({ endpoint: 'gke-abc-123.us-west1-a.gke.goog' })
  })

  test('keeps the IP endpoint and CA when the DNS endpoint is VPC-only', () => {
    expect(
      gkeApiServer({
        ...ipCluster,
        controlPlaneEndpointsConfig: {
          dnsEndpointConfig: {
            endpoint: 'gke-abc-123.us-west1-a.gke.goog',
            allowExternalTraffic: false,
          },
        },
      }),
    ).toEqual({ endpoint: '34.1.2.3', caBase64: 'R0NQLUNB' })
  })

  test('keeps the IP endpoint and CA without a DNS endpoint', () => {
    expect(gkeApiServer(ipCluster)).toEqual({ endpoint: '34.1.2.3', caBase64: 'R0NQLUNB' })
  })
})
