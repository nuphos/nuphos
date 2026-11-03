/**
 * Whether the view still follows the bottom after a scroll: near the bottom it
 * does; away from it, only if the reader did not move up. Content growing below
 * leaves the top where it was, so it never reads as leaving the bottom.
 */
export function stillStuck(stuck: boolean, near: boolean, top: number, lastTop: number): boolean {
  return near || (stuck && top >= lastTop)
}
