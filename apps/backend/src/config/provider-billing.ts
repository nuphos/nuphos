import { boundedInt, optional } from './env'

export function providerBillingConfig() {
  return {
    // What the cloud provider actually invoices us, as opposed to what we
    // derive from recorded tokens. Read from the BigQuery billing export and
    // synced into Mongo hourly; the whole feature no-ops when the table is
    // unset, so dev and self-host need no BigQuery access.
    providerBilling: {
      // Fully-qualified export table, e.g.
      // `my-project.billing_sync.billing_export`. It lives in a different GCP
      // project than the backend, so the runtime service account needs
      // bigquery.dataViewer there and bigquery.jobUser wherever jobs run.
      bigQueryTable: optional('PROVIDER_BILLING_BQ_TABLE')?.trim() || undefined,
      // Project the BigQuery *jobs* are billed to. Defaults to the table's own
      // project, which only works if we may run jobs there.
      bigQueryProjectId: optional('PROVIDER_BILLING_BQ_PROJECT_ID')?.trim() || undefined,
      // Which `project.id` in the export is ours. Everything else in the table
      // belongs to other Zeabur projects and must not be counted.
      gcpProjectId: optional('PROVIDER_BILLING_GCP_PROJECT_ID')?.trim() || 'nuphos',
      // How far back each sync re-reads. Billing rows keep landing for a day
      // or two after the usage hour, so a window shorter than this would
      // freeze yesterday's total at whatever had arrived by then.
      lookbackDays: boundedInt('PROVIDER_BILLING_LOOKBACK_DAYS', 5, { min: 1, max: 90 }),
      syncIntervalMinutes: boundedInt('PROVIDER_BILLING_SYNC_INTERVAL_MINUTES', 60, {
        min: 5,
        max: 1440,
      }),
    },
  }
}
