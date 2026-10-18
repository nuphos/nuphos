import { CloudLogo } from '../../components/CloudLogo'
import { DatabaseEngineGlyph } from '../../components/DatabaseEngineIcon'
import { LinearMark } from '../../components/LinearMark'

import type { AddIntegrationKey } from '../addIntegrationCatalog'

export function CatalogLogo({
  provider,
  size = 20,
}: {
  provider: AddIntegrationKey
  size?: number
}) {
  if (provider === 'linear') return <LinearMark size={size} />
  if (provider === 'mongodb') {
    return <DatabaseEngineGlyph engine="mongodb" className={size < 20 ? 'h-4 w-4' : 'h-5 w-5'} />
  }

  return <CloudLogo provider={provider} size={size} />
}
