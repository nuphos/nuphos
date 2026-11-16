import {
  Zap as ZapIcon,
  ChartLine as ChartLineIcon,
  Ellipsis as EllipsisIcon,
  Mail as MailIcon,
  Gauge as GaugeIcon,
  Globe as GlobeIcon,
  Network as NetworkIcon,
  Images as ImagesIcon,
  Bot as BotIcon,
  Shield as ShieldIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  User as UserIcon,
  ShieldUser as ShieldUserIcon,
} from 'lucide-react'
// Labels for Cloudflare's own OAuth scope categories (`category` in
// `GET /oauth/scopes`). The backend expands a category into the scopes the
// Nuphos OAuth client is registered with.

import { t } from '../../i18n/index.ts'

export const CLOUDFLARE_SCOPE_CATEGORIES = [
  {
    key: 'dns_and_zones',
    label: t('DNS & zones'),
    hint: t('Zones, records, registrar'),
    icon: GlobeIcon,
  },
  {
    key: 'developer_platform',
    label: t('Developer platform'),
    hint: 'Workers, Containers, Pages, R2, D1, KV, Queues',
    icon: ZapIcon,
  },
  {
    key: 'ai_and_machine_learning',
    label: 'AI',
    hint: 'Workers AI, AI Gateway, AI Search',
    icon: BotIcon,
  },
  {
    key: 'analytics_and_logs',
    label: t('Analytics & logs'),
    hint: t('Analytics, Logpush, Radar'),
    icon: ChartLineIcon,
  },
  {
    key: 'app_security',
    label: t('Application security'),
    hint: t('WAF, bots, DDoS, Page Shield'),
    icon: ShieldIcon,
  },
  {
    key: 'cache_and_performance',
    label: t('Cache & SSL'),
    hint: t('Cache settings, purge, certificates'),
    icon: GaugeIcon,
  },
  {
    key: 'cloudflare_one_and_zero_trust',
    label: 'Zero Trust',
    hint: 'Access, Gateway, Tunnels, WARP',
    icon: ShieldUserIcon,
  },
  {
    key: 'email_and_messaging',
    label: t('Email'),
    hint: t('Email Routing, Email Security, sending'),
    icon: MailIcon,
  },
  {
    key: 'media',
    label: t('Media'),
    hint: 'Images, Stream, Calls',
    icon: ImagesIcon,
  },
  {
    key: 'network_services',
    label: t('Network services'),
    hint: t('Load balancing, Magic Transit/WAN, IP prefixes'),
    icon: NetworkIcon,
  },
  {
    key: 'rules_and_configuration',
    label: t('Rules & configuration'),
    hint: t('Rulesets, redirects, transforms, custom pages'),
    icon: SlidersHorizontalIcon,
  },
  {
    key: 'account_and_billing',
    label: t('Account'),
    hint: t('Settings, members, API tokens, notifications'),
    icon: UserIcon,
  },
  {
    key: 'other',
    label: t('Other'),
    hint: t('Artifacts, resource sharing'),
    icon: EllipsisIcon,
  },
] as const
