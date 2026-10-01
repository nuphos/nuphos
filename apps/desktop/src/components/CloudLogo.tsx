import { faKubernetes } from '@fortawesome/free-brands-svg-icons'
import { faLaptop } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { DatabaseEngineGlyph } from './DatabaseEngineIcon'

type Props = {
  provider:
    | 'aws'
    | 'gcp'
    | 'cloudflare'
    | 'linode'
    | 'hetzner'
    | 'betterstack'
    | 'uptime-kuma'
    | 'jira'
    | 'asana'
    | 'sentry'
    | 'posthog'
    | 'tailscale'
    | 'grafana'
    | 'github'
    | 'gitlab'
    | 'linear'
    | 'zeabur'
    | 'vanta'
    | 'secureframe'
    | 'sonarqube'
    | 'notion'
    | 'upstash'
    | 'resend'
    | 'tencent'
    | 'aliyun'
    | 'volcengine'
    | 'huawei'
    | 'azure'
    | 'slack'
    | 'discord'
    | 'lark'
    | 'onprem-k8s'
    | 'mongodb'
    | 'device'
  size?: number
  className?: string
}

// Every mark is bundled locally (public/). These render as plain <img> with no
// retry or fallback, so a runtime CDN dependency turns any network blip —
// broken IPv6 paths, corporate firewalls, regional interference — into a
// permanently torn image. Snapshots of the former CDN sources (simpleicons /
// zeabur.com) live in the repo instead; refresh them by re-downloading.
const SRC = {
  aws: '/aws.svg',
  gcp: '/gcp.svg',
  cloudflare: '/cloudflare.svg',
  linode: '/akamai.png',
  hetzner: '/hetzner.svg',
  betterstack: '/betterstack.svg',
  'uptime-kuma': '/uptime-kuma.svg',
  jira: '/jira.svg',
  asana: '/asana.svg',
  sentry: '/sentry.svg',
  posthog: '/posthog-dark.svg',
  tailscale: '/tailscale-dark.svg',
  grafana: '/grafana.svg',
  github: '/github-dark.svg',
  gitlab: '/gitlab.svg',
  linear: '/linear.svg',
  zeabur: '/zeabur-dark-bg.svg',
  vanta: '/vanta.png',
  secureframe: '/secureframe.png',
  sonarqube: '/sonarqube.svg',
  // Notion's brand mark is monochrome; render white on the dark sidebar and
  // swap to black in light theme (same split as GitHub/Tailscale below).
  notion: '/notion-dark.svg',
  upstash: 'https://cdn.simpleicons.org/upstash/00E9A3',
  // Resend's mark is monochrome; no local asset, keep the CDN source.
  resend: 'https://cdn.simpleicons.org/resend/FFFFFF',
  tencent: '/tencent.svg',
  aliyun: '/aliyun.svg',
  volcengine: '/volcengine.svg',
  // Huawei's mark ships in simple-icons; no local asset needed.
  huawei: 'https://cdn.simpleicons.org/huawei/FF0000',
  azure: '/azure.svg',
  slack: '/slack.svg',
  discord: 'https://cdn.simpleicons.org/discord/5865F2',
  lark: '/lark.svg',
} as const

const AWS_DARK_SRC = '/aws-dark.svg'
const GITHUB_LIGHT_SRC = '/github-light.svg'
const TAILSCALE_LIGHT_SRC = '/tailscale-light.svg'
const ZEABUR_LIGHT_SRC = '/zeabur-light-bg.svg'

// Marks with a dark-on-light part: white variant on the dark theme, dark in light theme.
const THEMED_SRC = {
  notion: { alt: 'Notion', dark: SRC.notion, light: '/notion-light.svg' },
  resend: { alt: 'Resend', dark: SRC.resend, light: 'https://cdn.simpleicons.org/resend/181717' },
  posthog: { alt: 'PostHog', dark: SRC.posthog, light: '/posthog-light.svg' },
} as const

export function CloudLogo({ provider, size = 14, className = '' }: Props) {
  if (provider === 'mongodb') {
    return (
      <span
        className={`flex flex-shrink-0 items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <DatabaseEngineGlyph engine="mongodb" className="h-full w-full" />
      </span>
    )
  }

  if (provider === 'aws') {
    return (
      <span
        className={`cloud-logo-aws flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={AWS_DARK_SRC}
          alt="AWS"
          width={size}
          height={size}
          className="cloud-logo-aws-dark w-full h-full"
        />
        <img
          src={SRC.aws}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="cloud-logo-aws-light w-full h-full"
        />
      </span>
    )
  }

  if (provider === 'github') {
    return (
      <span
        className={`cloud-logo-github flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={SRC.github}
          alt="GitHub"
          width={size}
          height={size}
          className="cloud-logo-github-dark w-full h-full"
        />
        <img
          src={GITHUB_LIGHT_SRC}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="cloud-logo-github-light w-full h-full"
        />
      </span>
    )
  }

  if (provider === 'onprem-k8s') {
    return (
      <FontAwesomeIcon
        icon={faKubernetes}
        aria-label="Kubernetes"
        className={`flex-shrink-0 ${className}`}
        style={{ width: size, height: size, color: '#326ce5' }}
      />
    )
  }

  if (provider === 'device') {
    return (
      <FontAwesomeIcon
        icon={faLaptop}
        aria-label="Device"
        className={`flex-shrink-0 text-tertiary ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  if (provider === 'tailscale') {
    return (
      <span
        className={`cloud-logo-tailscale flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={SRC.tailscale}
          alt="Tailscale"
          width={size}
          height={size}
          className="cloud-logo-tailscale-dark w-full h-full"
        />
        <img
          src={TAILSCALE_LIGHT_SRC}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="cloud-logo-tailscale-light w-full h-full"
        />
      </span>
    )
  }

  const themed = provider in THEMED_SRC ? THEMED_SRC[provider as keyof typeof THEMED_SRC] : null

  if (themed) {
    return (
      <span
        className={`cloud-logo-github flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={themed.dark}
          alt={themed.alt}
          width={size}
          height={size}
          className="cloud-logo-github-dark w-full h-full object-contain"
        />
        <img
          src={themed.light}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="cloud-logo-github-light w-full h-full object-contain"
        />
      </span>
    )
  }

  if (provider === 'zeabur') {
    return (
      <span
        className={`cloud-logo-zeabur flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={SRC.zeabur}
          alt="Zeabur"
          width={size}
          height={size}
          className="cloud-logo-zeabur-dark w-full h-full object-contain"
        />
        <img
          src={ZEABUR_LIGHT_SRC}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="cloud-logo-zeabur-light w-full h-full object-contain"
        />
      </span>
    )
  }

  return (
    <img
      src={SRC[provider]}
      alt={provider.toUpperCase()}
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
