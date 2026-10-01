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

import type { NavItemMeta } from './types'

export function awsAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'aws.vpcs',
      label: 'VPCs',
      group: 'Network',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.nacls',
      label: 'Network ACLs',
      group: 'Network',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.clusters',
      label: 'EKS Clusters',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.ecs',
      label: 'ECS Clusters',
      group: 'Compute',
      icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.ec2',
      label: 'EC2 Instances',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.lightsail',
      label: 'Lightsail',
      group: 'Compute',
      icon: <Lightbulb className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.lambda',
      label: 'Lambda',
      group: 'Compute',
      icon: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudformation',
      label: 'CloudFormation',
      group: 'Deploy',
      icon: <Layers className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.s3',
      label: 'S3 Buckets',
      group: 'Storage',
      icon: <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'aws.cloudwatch',
      label: 'Logs',
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faAlignLeft} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudwatch-alarms',
      label: 'Alarms',
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faBell} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.cloudwatch-metrics',
      label: 'Metrics',
      group: 'CloudWatch',
      icon: <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'aws.roles',
      label: 'Roles',
      group: 'Identity',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function gcpProjectNavItems(): NavItemMeta[] {
  return [
    {
      key: 'gcp.vpcs',
      label: 'VPC Networks',
      group: 'Network',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.firewalls',
      label: 'Firewalls',
      group: 'Network',
      icon: <Flame className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.clusters',
      label: 'GKE Clusters',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.gce',
      label: 'Compute Engine',
      group: 'Compute',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.cloudrun',
      label: 'Cloud Run',
      group: 'Serverless',
      icon: <Workflow className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.metrics',
      label: 'Metrics',
      group: 'Observability',
      icon: <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'gcp.dashboards',
      label: 'Dashboards',
      group: 'Observability',
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'gcp.service-accounts',
      label: 'Service Accounts',
      group: 'Identity',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function azureSubscriptionNavItems(): NavItemMeta[] {
  return [
    {
      key: 'azure.apps',
      label: 'Apps',
      group: 'Identity',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function cloudflareAccountNavItems(): NavItemMeta[] {
  return [
    {
      key: 'cloudflare.zones',
      label: 'Domains',
      group: 'DNS',
      icon: <Globe className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
    {
      key: 'cloudflare.workers',
      label: 'Workers',
      group: 'Compute & Storage',
      icon: <FontAwesomeIcon icon={faBolt} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.r2',
      label: 'R2',
      group: 'Compute & Storage',
      icon: <FontAwesomeIcon icon={faHardDrive} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.pages',
      label: 'Pages',
      group: 'Compute & Storage',
      icon: <FontAwesomeIcon icon={faLayerGroup} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.d1',
      label: 'D1',
      group: 'Data',
      icon: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.kv',
      label: 'KV',
      group: 'Data',
      icon: <FontAwesomeIcon icon={faKey} className="w-3.5 h-3.5 text-tertiary" />,
    },
    {
      key: 'cloudflare.iam',
      label: 'IAM Settings',
      group: 'Identity',
      icon: <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}

export function cloudflareZoneNavItems(): NavItemMeta[] {
  return [
    {
      key: 'cloudflare.dns',
      label: 'DNS Records',
      group: 'DNS',
      icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    },
  ]
}
