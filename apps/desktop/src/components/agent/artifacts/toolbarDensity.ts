/**
 * How much of the toolbar fits the dock. Full shows every control; compact
 * folds Copy and Download into More; tiny also folds the version steps and
 * the fix prompt, so the title still reads in a 200px pane.
 */
export type ToolbarDensity = 'full' | 'compact' | 'tiny'

export function toolbarDensity(width: number): ToolbarDensity {
  if (width === 0 || width >= 520) return 'full'

  return width >= 300 ? 'compact' : 'tiny'
}
