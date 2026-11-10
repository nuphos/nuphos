/**
 * A row being dragged follows the pointer as a small card, its face over its
 * name, instead of the browser's faded snapshot of the whole row.
 */
export function setRowDragImage(
  event: { dataTransfer: DataTransfer | null },
  row: HTMLElement,
  label: string,
) {
  const card = document.createElement('div')

  card.className =
    'fixed -left-[999px] top-0 flex w-[112px] flex-col items-center gap-1.5 rounded-xl border border-line-control bg-elevated px-3 py-2.5 shadow-lg'
  const icon = row.querySelector('button > span')?.cloneNode(true)

  if (icon instanceof HTMLElement) {
    icon.className = 'flex size-9 items-center justify-center [&>*]:!size-9 [&_svg]:!size-5'
    card.appendChild(icon)
  }
  const name = document.createElement('div')

  name.className = 'max-w-full truncate text-[12px] font-medium text-main'
  name.textContent = label
  card.appendChild(name)
  document.body.appendChild(card)
  event.dataTransfer?.setDragImage(card, 56, 24)
  requestAnimationFrame(() => card.remove())
}
