/**
 * How much to shrink a screen so all of it fits the space Play has: real size
 * when it fits, scaled down evenly when it doesn't. Before the space is
 * measured (0×0) the screen shows at real size.
 */
export function playFitScale(
  screen: { width: number; height: number },
  space: { width: number; height: number },
): number {
  if (space.width <= 0 || space.height <= 0) return 1

  return Math.min(1, space.width / screen.width, space.height / screen.height)
}
