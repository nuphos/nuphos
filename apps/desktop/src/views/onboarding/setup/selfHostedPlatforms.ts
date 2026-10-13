/** Where a self-hosted cloud agent can run, and the one link that deploys it there. */
export const SELF_HOSTED_PLATFORMS = {
  zeabur: {
    name: 'Zeabur',
    tag: 'Template',
    url: 'https://github.com/nuphos/nuphos/tree/main/deploy/zeabur',
  },
  railway: {
    name: 'Railway',
    tag: 'Template',
    url: 'https://railway.com/deploy/nuphos-agent-runtime',
  },
  compose: {
    name: 'Docker Compose',
    tag: 'Any server with Docker',
    url: 'https://github.com/nuphos/nuphos/tree/main/deploy/compose',
  },
} as const satisfies Record<string, { name: string; tag: string; url: string }>

export type SelfHostedPlatform = keyof typeof SELF_HOSTED_PLATFORMS

export const SELF_HOSTED_PLATFORM_IDS = Object.keys(SELF_HOSTED_PLATFORMS) as SelfHostedPlatform[]
