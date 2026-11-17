import type { JobsOptions } from 'bullmq'

type ReportJob = {
  getState: () => Promise<string>
  retry: (state: 'failed', options: { resetAttemptsMade: boolean }) => Promise<void>
}
type ReportQueue = {
  getJob: (id: string) => Promise<ReportJob | undefined>
  add: (name: string, data: { reportId: string }, options: JobsOptions) => Promise<unknown>
}

export async function enqueueReport(queue: ReportQueue, reportId: string): Promise<void> {
  const jobId = `task-report-${reportId}`
  const existing = await queue.getJob(jobId)

  if (existing) {
    if ((await existing.getState()) === 'failed') {
      try {
        await existing.retry('failed', { resetAttemptsMade: true })
      } catch (error) {
        // Another caller may already have moved this same job back to waiting.
        if ((await existing.getState()) === 'failed') throw error
      }
    }

    return
  }
  await queue.add(
    'task-report',
    { reportId },
    {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 30 * 86400 },
      removeOnFail: false,
    },
  )
}
