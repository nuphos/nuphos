export type TeamImportPreview = {
  token: string
  sha256: string
  name: string
  manifest: { totals: { records: number; bytes: number } }
  members: { sourceUserId: string; name: string; email: string | null }[]
  excluded: { category: string; label?: string; reason: string; nextAction: string }[]
}
