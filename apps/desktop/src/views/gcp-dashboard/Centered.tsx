import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export function CenteredError({ message }: { message: string }) {
  useReportVisibleError(message, 'gcp_dashboard_centered_error')

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-xl whitespace-pre-wrap text-center text-[12.5px] text-error">
        {message}
      </div>
    </div>
  )
}

export function CenteredMessage({ children }: { children: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[12.5px] text-tertiary">
      {children}
    </div>
  )
}
