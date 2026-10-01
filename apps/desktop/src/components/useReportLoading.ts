import { useEffect } from 'react'

export function useReportLoading(loading: boolean, onLoading?: (loading: boolean) => void): void {
  useEffect(() => {
    onLoading?.(loading)

    return () => {
      if (loading) onLoading?.(false)
    }
  }, [loading, onLoading])
}
