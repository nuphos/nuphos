import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export function ChipList({ values, empty = '-' }: { values: string[]; empty?: string }) {
  if (values.length === 0) return <span className="text-tertiary">{empty}</span>

  return (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {values.slice(0, 3).map((value) => (
        <span
          key={value}
          className="truncate rounded bg-zGray-850 px-1.5 py-0.5 font-mono text-[11.5px] text-secondary"
          title={value}
        >
          {value}
        </span>
      ))}
      {values.length > 3 && (
        <span className="flex-shrink-0 text-[11.5px] text-tertiary">+{values.length - 3}</span>
      )}
    </span>
  )
}

export function ErrorState({ message }: { message: string }) {
  useReportVisibleError(message, 'k8s_error_state')

  return (
    <div className="p-8 text-center">
      <div className="text-error text-[13px]">{message}</div>
    </div>
  )
}
