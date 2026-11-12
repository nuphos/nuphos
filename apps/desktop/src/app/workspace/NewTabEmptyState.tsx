import { t } from '../../i18n'

export function NewTabEmptyState({
  loading,
  empty,
  noConnectors,
  searching,
  noMatches,
  onOpenKey,
}: {
  loading: boolean
  empty: boolean
  noConnectors: boolean
  searching: boolean
  noMatches: boolean
  onOpenKey: (key: string, label: string | null, newTab: boolean) => void
}) {
  return (
    <>
      {loading && empty && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-9 animate-pulse rounded-md bg-state-selected" />
          ))}
        </div>
      )}

      {!loading && (noConnectors || noMatches) && (
        <div className="flex flex-col items-center rounded-lg px-6 py-6 text-center">
          <p className="text-[12.5px] text-tertiary">
            {searching ? t('No matching destinations') : t('No connected resources yet')}
          </p>
          {!searching && (
            <button
              type="button"
              onClick={() => onOpenKey('team.integrations', null, false)}
              className="mt-3 rounded-md bg-surface-sunken px-2.5 py-1 text-[12px] font-medium text-main transition-colors hover:bg-state-hover"
            >
              {t('Add a connector')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
