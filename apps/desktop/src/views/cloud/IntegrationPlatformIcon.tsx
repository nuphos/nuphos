import { CloudLogo } from '../../components/CloudLogo'
import { DatabaseEngineGlyph } from '../../components/DatabaseEngineIcon'
import { GithubMark } from '../../components/GithubMark'
import { LinearMark } from '../../components/LinearMark'

import type { IntegrationPlatformRow } from './team-home-bind'

export function IntegrationPlatformIcon({
  provider,
  size = 16,
}: {
  provider: IntegrationPlatformRow['provider']
  size?: number
}) {
  if (provider === 'mongodb') {
    return <DatabaseEngineGlyph engine="mongodb" className={size === 20 ? 'h-5 w-5' : 'h-4 w-4'} />
  }
  if (provider === 'github') {
    return <GithubMark size={size} className="text-secondary" />
  }
  if (provider === 'gitlab') {
    return <CloudLogo provider="gitlab" size={size} />
  }
  if (provider === 'linear') {
    return <LinearMark size={size} className="text-secondary" />
  }
  if (provider === 'jira') {
    return <CloudLogo provider="jira" size={size} />
  }
  if (provider === 'sentry') {
    return <CloudLogo provider="sentry" size={size} />
  }
  if (provider === 'asana') {
    return <CloudLogo provider="asana" size={size} />
  }
  if (provider === 'slack') {
    return <CloudLogo provider="slack" size={size} />
  }
  if (provider === 'lark') {
    return <CloudLogo provider="lark" size={size} />
  }
  if (provider === 'grafana') {
    return <CloudLogo provider="grafana" size={size} />
  }

  return <CloudLogo provider={provider} size={size} />
}
