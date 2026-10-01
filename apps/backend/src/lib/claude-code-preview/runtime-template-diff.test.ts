import { describe, expect, test } from 'bun:test'

import { hostedRuntimeDeploymentObject } from './runtime-deployment'
import { podTemplateChanged } from './runtime-template-diff'
// A Deployment as the API server returns it, captured from the cluster with
// every default filled in — the shape the provisioner compares against.
import liveDeployment from './testdata/live-runtime-deployment.json'

type PodSpec = Record<string, unknown>

const live = liveDeployment as unknown as {
  metadata: { name: string; labels: Record<string, string> }
  spec: {
    replicas: number
    template: {
      metadata: { labels: Record<string, string>; annotations?: Record<string, string> }
      spec: PodSpec & {
        nodeSelector: Record<string, string>
        tolerations: { key: string; value: string }[]
        containers: {
          image: string
          resources: { limits: { cpu?: string } }
          env: { name: string; valueFrom?: { secretKeyRef: { name: string } } }[]
        }[]
        volumes: { name: string }[]
      }
    }
  }
}
const liveTemplate = live.spec.template
const liveSpec = liveTemplate.spec
const teamId = live.metadata.labels['nuphos.io/team-id']!
const runtimeId = liveSpec.containers[0]!.env.find(
  (entry) => entry.name === 'OPENAB_ACP_AUTH_KEY',
)!.valueFrom!.secretKeyRef.name.replace(`openab-runtime-${teamId}-`, '')

function desiredTemplate(
  overrides: { cpuLimit?: string | null; nodeSelector?: Record<string, string> } = {},
): Record<string, unknown> {
  const cpuLimit =
    overrides.cpuLimit === undefined
      ? liveSpec.containers[0]!.resources.limits.cpu
      : overrides.cpuLimit
  const deployment = hostedRuntimeDeploymentObject({
    name: live.metadata.name,
    teamId,
    runtimeId,
    namespace: 'openab-runtimes',
    image: liveSpec.containers[0]!.image,
    provider: 'claude-code',
    running: live.spec.replicas > 0,
    scheduling: {
      nodeSelector: overrides.nodeSelector ?? liveSpec.nodeSelector,
      tolerations: liveSpec.tolerations.map(({ key, value }) => ({ key, value })),
      ...(cpuLimit ? { cpuLimit } : {}),
    },
  })

  return (deployment.spec as { template: Record<string, unknown> }).template
}

describe('runtime pod template diff', () => {
  test('the desired template the fixture was built from reads as unchanged', () => {
    // The two are not equal — the fixture carries the defaults the API server
    // added — so this is the normalization being exercised, not a tautology.
    expect(desiredTemplate()).not.toEqual(liveTemplate)
    expect(podTemplateChanged(desiredTemplate(), liveTemplate)).toBe(false)
  })

  test('the same CPU limit spelled differently is not a change', () => {
    expect(podTemplateChanged(desiredTemplate({ cpuLimit: '4000m' }), liveTemplate)).toBe(false)
  })

  test('the template changes that restarted live turns are all detected', () => {
    expect(podTemplateChanged(desiredTemplate({ cpuLimit: null }), liveTemplate)).toBe(true)
    expect(podTemplateChanged(desiredTemplate({ cpuLimit: '2' }), liveTemplate)).toBe(true)
    expect(podTemplateChanged(desiredTemplate({ nodeSelector: {} }), liveTemplate)).toBe(true)
  })

  test('a volume only the live pod carries reads as a removal', () => {
    const withSkillsVolume = {
      ...liveTemplate,
      spec: { ...liveSpec, volumes: [...liveSpec.volumes, { name: 'skills', emptyDir: {} }] },
    }

    expect(podTemplateChanged(desiredTemplate(), withSkillsVolume)).toBe(true)
  })

  test('a pod label change is a change, an unowned annotation is not', () => {
    const metadata = liveTemplate.metadata

    expect(
      podTemplateChanged(desiredTemplate(), {
        ...liveTemplate,
        metadata: { ...metadata, labels: { ...metadata.labels, 'nuphos.io/pool': 'shared' } },
      }),
    ).toBe(true)
    expect(
      podTemplateChanged(desiredTemplate(), {
        ...liveTemplate,
        metadata: {
          ...metadata,
          annotations: { ...metadata.annotations, 'kubectl.kubernetes.io/restartedAt': 'now' },
        },
      }),
    ).toBe(false)
  })

  test('dropping a security context is a change, an empty one is a default', () => {
    const desired = desiredTemplate()
    const podSpec = desired.spec as Record<string, unknown>
    const containers = podSpec.containers as Record<string, unknown>[]

    expect(
      podTemplateChanged(
        { ...desired, spec: { ...podSpec, securityContext: undefined } },
        liveTemplate,
      ),
    ).toBe(true)
    expect(
      podTemplateChanged(
        {
          ...desired,
          spec: {
            ...podSpec,
            containers: containers.map(({ securityContext: _dropped, ...rest }) => rest),
          },
        },
        liveTemplate,
      ),
    ).toBe(true)
    expect(
      podTemplateChanged(desiredTemplate(), {
        ...liveTemplate,
        spec: { ...liveSpec, resources: {} },
      }),
    ).toBe(false)
  })

  test('an unreadable live template counts as changed', () => {
    expect(podTemplateChanged(desiredTemplate(), undefined)).toBe(true)
  })
})
