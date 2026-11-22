import { CATALOG } from '../../../views/addIntegrationCatalog'
import { PERSONAL_CONNECTORS, nameOf } from '../../../views/settings/personalCredentials'

import type { ConnectProvider } from './connectCardModel'
import type { PersonalCredentialProvider } from '../../../types'
import type { CatalogItem } from '../../../views/addIntegrationCatalog'

const CATALOG_ITEMS = new Map<string, CatalogItem>(
  CATALOG.flatMap((category) => category.items).map((item) => [item.key, item]),
)

/** A row's name and blurb: the Add connector catalog's, else the member's own credential's. */
export function connectItem(
  provider: ConnectProvider | PersonalCredentialProvider,
): { name: string; description: string } | undefined {
  const item = CATALOG_ITEMS.get(provider)
  const own = PERSONAL_CONNECTORS.find((connector) => connector.provider === provider)

  if (item) return item

  return own && { name: nameOf(own.provider), description: own.summary }
}
