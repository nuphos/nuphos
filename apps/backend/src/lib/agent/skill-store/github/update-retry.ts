import { skillMetadataRepository } from '@/lib/agent/skill-store/metadata'

/** The package ETags this request's own write left, if that write already applied. */
export async function appliedPut(
  mutationId: string | undefined,
): Promise<Record<string, string> | null> {
  if (!mutationId) return null
  const result = await skillMetadataRepository().getResult(mutationId)

  return result?.status === 'applied' ? result.afterEtags : null
}

/** Only this request's write (and deletes) may differ from what it left; anything else is an edit. */
export function onlyOurChanges(
  current: Record<string, string>,
  written: Record<string, string>,
): boolean {
  return Object.entries(current).every(([key, etag]) => written[key] === etag)
}
