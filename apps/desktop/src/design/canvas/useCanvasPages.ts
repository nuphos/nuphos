import { useCallback } from 'react'

import { cloneObjects } from './clipboard'
import { genId } from './helpers'

import type { Design, DesignPage } from '../schema'
import type { useDesignHistory } from './useDesignHistory'
import type { Dispatch, SetStateAction } from 'react'

type Args = {
  design: Design
  setDesign: Dispatch<SetStateAction<Design>>
  history: ReturnType<typeof useDesignHistory>
  pageId: string
  setPageId: (id: string) => void
}

/** Add, copy, rename and remove pages; the last page stays. */
export function useCanvasPages({ design, setDesign, history, pageId, setPageId }: Args) {
  const { record } = history
  const addPage = useCallback(() => {
    const id = genId()

    record()
    setDesign((d) => ({
      ...d,
      pages: [
        ...d.pages,
        { id, name: `Page ${String(d.pages.length + 1)}`, objects: [], links: [] },
      ],
    }))
    setPageId(id)
  }, [record, setDesign, setPageId])

  const duplicatePage = useCallback(
    (id: string) => {
      const source = design.pages.find((p) => p.id === id)

      if (!source) return
      const copy = cloneObjects(source.objects, source.links, 0)
      const nextId = genId()

      record()
      setDesign((d) => {
        const at = d.pages.findIndex((p) => p.id === id)
        const pageCopy: DesignPage = { id: nextId, name: `${source.name} copy`, ...copy }

        return { ...d, pages: [...d.pages.slice(0, at + 1), pageCopy, ...d.pages.slice(at + 1)] }
      })
      setPageId(nextId)
    },
    [design.pages, record, setDesign, setPageId],
  )

  const deletePage = useCallback(
    (id: string) => {
      if (design.pages.length <= 1) return
      const remaining = design.pages.filter((p) => p.id !== id)

      record()
      setDesign((d) => ({ ...d, pages: d.pages.filter((p) => p.id !== id) }))
      if (pageId === id && remaining[0]) setPageId(remaining[0].id)
    },
    [design.pages, record, pageId, setDesign, setPageId],
  )

  const renamePage = useCallback(
    (id: string, name: string) => {
      record()
      setDesign((d) => ({ ...d, pages: d.pages.map((p) => (p.id === id ? { ...p, name } : p)) }))
    },
    [record, setDesign],
  )

  return { addPage, duplicatePage, deletePage, renamePage }
}
