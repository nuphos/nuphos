// The shape of the guided setups' picture library. One file per cloud sits
// beside this one; `cloudBindScreenshots.ts` assembles them and answers lookups.

export type SetupScreenshot = {
  /** Path under `public/`. */
  src: string
  alt: string
  /** Intrinsic ratio, so the step reserves its space before the image loads. */
  aspectRatio: string
}

/** One cloud's screenshots for one purpose, keyed by step TITLE.
 *
 *  Title rather than index: an index silently points at the wrong picture the day
 *  a step is inserted, whereas a renamed step just loses its screenshot until
 *  someone re-keys it. */
export type StepScreenshots = Partial<Record<string, readonly SetupScreenshot[]>>

export type ProviderScreenshots = {
  operational: StepScreenshots
}
