import {
  faAlignLeft,
  faBell,
  faBolt,
  faChartLine,
  faDatabase,
  faHardDrive,
  faKey,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  ChartLine,
  Cloud,
  Container,
  Database,
  Flame,
  Globe,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react'

import { t } from '../../i18n'

import type { Section } from './types'

export function awsSections(): Section[] {
  return [
    {
      title: t('Network'),
      items: [
        { key: 'aws.vpcs', label: 'VPCs', icon: Cloud, enabled: true },
        { key: 'aws.nacls', label: t('Network ACLs'), icon: ShieldCheck, enabled: true },
      ],
    },
    {
      title: t('Compute'),
      items: [
        { key: 'aws.clusters', label: t('EKS Clusters'), icon: Server, enabled: true },
        { key: 'aws.ecs', label: t('ECS Clusters'), icon: Container, enabled: true },
        { key: 'aws.ec2', label: t('EC2 Instances'), icon: Server, enabled: true },
        { key: 'aws.lightsail', label: 'Lightsail', icon: Lightbulb, enabled: true },
        {
          key: 'aws.lambda',
          label: 'Lambda',
          iconNode: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
    {
      title: t('Deploy'),
      items: [{ key: 'aws.cloudformation', label: 'CloudFormation', icon: Layers, enabled: true }],
    },
    {
      title: t('Storage'),
      items: [{ key: 'aws.s3', label: t('S3 Buckets'), icon: Database, enabled: true }],
    },
    {
      title: 'CloudWatch',
      items: [
        {
          key: 'aws.cloudwatch',
          label: t('Logs'),
          iconNode: <FontAwesomeIcon icon={faAlignLeft} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'aws.cloudwatch-alarms',
          label: t('Alarms'),
          iconNode: <FontAwesomeIcon icon={faBell} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'aws.cloudwatch-metrics',
          label: t('Metrics'),
          iconNode: <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
  ]
}

export function gcpSections(): Section[] {
  return [
    {
      title: t('Network'),
      items: [
        { key: 'gcp.vpcs', label: t('VPC Networks'), icon: Cloud, enabled: true },
        { key: 'gcp.firewalls', label: t('Firewalls'), icon: Flame, enabled: true },
      ],
    },
    {
      title: t('Compute'),
      items: [
        { key: 'gcp.clusters', label: t('GKE Clusters'), icon: Server, enabled: true },
        { key: 'gcp.gce', label: 'Compute Engine', icon: Server, enabled: true },
      ],
    },
    {
      title: t('Serverless'),
      items: [{ key: 'gcp.cloudrun', label: 'Cloud Run', icon: Workflow, enabled: true }],
    },
    {
      title: t('Observability'),
      items: [
        { key: 'gcp.metrics', label: t('Metrics'), icon: ChartLine, enabled: true },
        { key: 'gcp.dashboards', label: t('Dashboards'), icon: LayoutDashboard, enabled: true },
      ],
    },
  ]
}

export function linodeSections(): Section[] {
  return [
    {
      title: t('Compute'),
      items: [{ key: 'linode.instances', label: 'Linodes', icon: Server, enabled: true }],
    },
    {
      title: 'Kubernetes',
      items: [{ key: 'linode.lke', label: t('LKE Clusters'), icon: Container, enabled: true }],
    },
  ]
}

export function hetznerSections(): Section[] {
  return [
    {
      title: t('Compute'),
      items: [{ key: 'hetzner.servers', label: t('Servers'), icon: Server, enabled: true }],
    },
  ]
}

export function tencentSections(): Section[] {
  return [
    {
      title: t('Compute'),
      items: [{ key: 'tencent.cvm', label: t('CVM Instances'), icon: Server, enabled: true }],
    },
    {
      title: 'Kubernetes',
      items: [
        { key: 'tencent.clusters', label: t('TKE Clusters'), icon: Container, enabled: true },
      ],
    },
  ]
}

export function aliyunSections(): Section[] {
  return [
    {
      title: t('Compute'),
      items: [
        { key: 'aliyun.ecs', label: t('ECS Instances'), icon: Server, enabled: true },
        { key: 'aliyun.swas', label: 'Simple App Server', icon: Server, enabled: true },
      ],
    },
    {
      title: 'Kubernetes',
      items: [{ key: 'aliyun.clusters', label: t('ACK Clusters'), icon: Container, enabled: true }],
    },
  ]
}

export function volcengineSections(): Section[] {
  return [
    {
      title: t('Compute'),
      items: [{ key: 'volcengine.ecs', label: t('ECS Instances'), icon: Server, enabled: true }],
    },
    {
      title: 'Kubernetes',
      items: [
        { key: 'volcengine.clusters', label: t('VKE Clusters'), icon: Container, enabled: true },
      ],
    },
  ]
}

export function zeaburSections(): Section[] {
  return [
    {
      title: t('Deployments'),
      items: [{ key: 'zeabur.projects', label: t('Projects'), icon: Workflow, enabled: true }],
    },
    {
      title: t('Compute'),
      items: [{ key: 'zeabur.servers', label: t('Servers'), icon: Server, enabled: true }],
    },
  ]
}

export function cloudflareSections(): Section[] {
  return [
    {
      title: 'DNS',
      items: [{ key: 'cloudflare.zones', label: t('Domains'), icon: Globe, enabled: true }],
    },
    {
      title: t('Compute & Storage'),
      items: [
        {
          key: 'cloudflare.workers',
          label: 'Workers',
          iconNode: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'cloudflare.r2',
          label: 'R2',
          iconNode: <FontAwesomeIcon icon={faHardDrive} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'cloudflare.pages',
          label: 'Pages',
          iconNode: <FontAwesomeIcon icon={faLayerGroup} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
    {
      title: t('Data'),
      items: [
        {
          key: 'cloudflare.d1',
          label: 'D1',
          iconNode: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'cloudflare.kv',
          label: 'KV',
          iconNode: <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
  ]
}

export function cloudflareZoneSections(): Section[] {
  return [
    {
      title: 'DNS',
      items: [{ key: 'cloudflare.dns', label: t('DNS Records'), icon: Cloud, enabled: true }],
    },
  ]
}
