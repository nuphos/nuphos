/** Coalesce arrow-key commits; closing the picker saves its final committed stop. */
export function effortCommit() {
  let pending: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    const commit = pending

    pending = undefined
    timer = undefined
    commit?.()
  }

  return {
    schedule(commit: (() => void) | undefined) {
      clearTimeout(timer)
      pending = commit
      timer = commit ? setTimeout(flush, 350) : undefined
    },
    flush,
  }
}
