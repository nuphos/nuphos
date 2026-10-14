import { CATALOG } from '../../../views/addIntegrationCatalog'

// Name and one-line blurb per connector, from the Add connector catalog.
export const CONNECT_ITEMS = new Map(
  CATALOG.flatMap((category) => category.items).map((item) => [item.key, item]),
)
