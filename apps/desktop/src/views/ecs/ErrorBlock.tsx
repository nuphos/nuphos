import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export function ErrorBlock({ message }: { message: string }) {
  useReportVisibleError(message, 'ecs_error_block')

  return <div className="p-8 text-error text-[13px]">{message}</div>
}
