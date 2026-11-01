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
  Cloud,
  Container,
  Database,
  Flame,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react'

import { t } from '../../i18n'

import type { NavItemMeta } from './types'

export function awsAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'aws.vpcs',
      label: t('VPCs'),
      group: t('Network'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.nacls',
      label: t('Network ACLs'),
      group: t('Network'),
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.clusters',
      label: t('EKS Clusters'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.ecs',
      label: t('ECS Clusters'),
      group: t('Compute'),
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.ec2',
      label: t('EC2 Instances'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.lightsail',
      label: 'Lightsail',
      group: t('Compute'),
      icon: <Lightbulb className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.lambda',
      label: 'Lambda',
      group: t('Compute'),
      icon: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudformation',
      label: 'CloudFormation',
      group: t('Deploy'),
      icon: <Layers className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.s3',
      label: t('S3 Buckets'),
      group: t('Storage'),
      icon: <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.cloudwatch',
      label: t('Logs'),
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faAlignLeft} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudwatch-alarms',
      label: t('Alarms'),
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faBell} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudwatch-metrics',
      label: t('Metrics'),
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.roles',
      label: t('Roles'),
      group: t('Identity'),
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function gcpProjectNavItems(): NavItemMeta[] {
  return [
    {
      key: 'gcp.vpcs',
      label: t('VPC Networks'),
      group: t('Network'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.firewalls',
      label: t('Firewalls'),
      group: t('Network'),
      icon: <Flame className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.clusters',
      label: t('GKE Clusters'),
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.gce',
      label: 'Compute Engine',
      group: t('Compute'),
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.cloudrun',
      label: 'Cloud Run',
      group: t('Serverless'),
      icon: <Workflow className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.metrics',
      label: t('Metrics'),
      group: t('Observability'),
      icon: <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'gcp.dashboards',
      label: t('Dashboards'),
      group: t('Observability'),
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.service-accounts',
      label: t('Service Accounts'),
      group: t('Identity'),
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function azureSubscriptionNavItems(): NavItemMeta[] {
  return [
    {
      key: 'azure.apps',
      label: t('Apps'),
      group: t('Identity'),
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function cloudflareAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'cloudflare.zones',
      label: t('Domains'),
      group: t('DNS'),
      icon: <Globe className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cloudflare.workers',
      label: 'Workers',
      group: t('Compute & Storage'),
      icon: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.r2',
      label: 'R2',
      group: t('Compute & Storage'),
      icon: <FontAwesomeIcon icon={faHardDrive} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.pages',
      label: 'Pages',
      group: t('Compute & Storage'),
      icon: <FontAwesomeIcon icon={faLayerGroup} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.d1',
      label: 'D1',
      group: t('Data'),
      icon: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.kv',
      label: 'KV',
      group: t('Data'),
      icon: <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.iam',
      label: t('IAM Settings'),
      group: t('Identity'),
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function cloudflareZoneNavItems(): NavItemMeta[] {
  return [
    {
      key: 'cloudflare.dns',
      label: t('DNS Records'),
      group: t('DNS'),
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}
