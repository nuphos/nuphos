import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export function ErrorPanel({ message }: { message: string }) {
  useReportVisibleError(message, 'gitlab_error_panel')

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
        {message}
      </div>
    </div>
  )
}

export function LoadingPanel() {
  return (
    <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
      Loading…
    </div>
  )
}
