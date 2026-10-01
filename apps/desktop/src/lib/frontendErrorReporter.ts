export type FrontendErrorReport = {
  source: string
  phase?: string
  message: string
  [key: string]: unknown
}

type Reporter = (report: FrontendErrorReport, cause?: unknown) => void

let reporter: Reporter | undefined

export function setFrontendErrorReporter(next: Reporter): void {
  reporter = next
}

/** Lightweight bridge for low-level modules that must not import PostHog. */
export function reportFrontendError(report: FrontendErrorReport, cause?: unknown): void {
  reporter?.(report, cause)
}

/** Create and report a semantic failure carried by an otherwise successful response. */
export function createReportedError(report: FrontendErrorReport): Error {
  const error = new Error(report.message)

  reportFrontendError(report, error)

  return error
}
