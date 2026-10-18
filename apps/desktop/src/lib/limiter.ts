/** Runs queued tasks at most `max` at a time, in the order they were queued. */
export function createLimiter(max: number) {
  const queue: (() => Promise<unknown>)[] = []
  let running = 0

  function next() {
    while (running < max) {
      const task = queue.shift()

      if (!task) return
      running += 1
      void task()
        .catch(() => null)
        .finally(() => {
          running -= 1
          next()
        })
    }
  }

  return (task: () => Promise<unknown>) => {
    queue.push(task)
    next()
  }
}
