import { useReportVisibleError } from '../../components/VisibleErrorReporter'

export type CommonProps = {
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function ErrorBlock({ message }: { message: string }) {
  useReportVisibleError(message, 'linode_error_block')

  return <div className="p-8 text-error text-[13px]">{message}</div>
}
