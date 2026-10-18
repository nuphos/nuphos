import type { AddIntegrationKey, CatalogCategory, CatalogItem } from '../addIntegrationCatalog'

// The connectors most teams add first. An empty search suggests these ahead of
// the rest of the catalog.
const POPULAR: readonly AddIntegrationKey[] = [
  'github',
  'aws',
  'gcp',
  'linear',
  'slack',
  'grafana',
  'sentry',
  'notion',
  'cloudflare',
  'jira',
]

const SUGGESTION_LIMIT = 8

/** The words of a search, folded the way catalog haystacks are. */
export function searchTerms(filter: string): string[] {
  return filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * What the search field's dropdown lists. With nothing typed: connectors the
 * team has not added yet, popular first. While typing: every match, installed
 * or not, in catalog order.
 */
export function connectorSuggestions(
  catalog: readonly CatalogCategory[],
  filter: string,
  installed: ReadonlySet<string>,
): CatalogItem[] {
  const items = catalog.flatMap((category) => category.items)
  const terms = searchTerms(filter)

  if (terms.length > 0) {
    return items
      .filter((item) => terms.every((term) => item.haystack.includes(term)))
      .slice(0, SUGGESTION_LIMIT)
  }
  const rank = (item: CatalogItem) => {
    const index = POPULAR.indexOf(item.key)

    return index === -1 ? POPULAR.length : index
  }

  return items
    .filter((item) => !installed.has(item.key))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, SUGGESTION_LIMIT)
}
