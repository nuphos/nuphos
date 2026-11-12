export type PinBox = { key: string; left: number; top: number; width: number; height: number }

/** Three compact pins fit the default 248px sidebar after its inner padding. */
export function pinGridColumns(width: number): number {
  return Math.max(1, Math.min(3, Math.floor((width - 4) / 72)))
}

/** Reading order is left to right within each row, then down. */
export function pinBeforeAt(
  boxes: PinBox[],
  dragged: string,
  x: number,
  y: number,
): string | null | undefined {
  const inside = boxes.find(
    (box) =>
      x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height,
  )

  if (inside?.key === dragged) return undefined
  const others = boxes.filter((box) => box.key !== dragged)

  if (!others.length) return null
  const distance = (box: PinBox) =>
    ((x - box.left - box.width / 2) / box.width) ** 2 +
    ((y - box.top - box.height / 2) / box.height) ** 2
  const closest = others.reduce(
    (best, box) => (distance(box) < distance(best) ? box : best),
    others[0],
  )
  const before =
    y < closest.top || (y <= closest.top + closest.height && x < closest.left + closest.width / 2)
  const index = others.indexOf(closest) + (before ? 0 : 1)

  return others[index]?.key ?? null
}

export function previewPinOrder<T extends { key: string }>(
  pins: T[],
  dragged: T | undefined,
  before: string | null | undefined,
): T[] {
  if (!dragged) return pins
  if (before === undefined && pins.some((pin) => pin.key === dragged.key)) return pins
  const rest = pins.filter((pin) => pin.key !== dragged.key)
  const index = before ? rest.findIndex((pin) => pin.key === before) : -1

  rest.splice(index < 0 ? rest.length : index, 0, dragged)

  return rest
}
