// Compares a pull request's iOS UI test results with main's latest nightly run, both as written by
// `xcrun xcresulttool get test-results tests`. A new failure is a test that fails on the pull
// request and passed on main, or that main does not have; only those fail the pull request.
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Each test case's result, by its identifier (`Suite/testName()`). */
export function results(json) {
  const byTest = new Map()
  const walk = (node) => {
    if (node.nodeType === 'Test Case') byTest.set(node.nodeIdentifier ?? node.name, node.result)
    for (const child of node.children ?? []) walk(child)
  }

  for (const node of json.testNodes ?? []) walk(node)

  return byTest
}

export function compare(branch, main) {
  const newFailures = []
  const stillFailing = []
  const fixed = []

  for (const [test, result] of branch) {
    const before = main.get(test)

    if (result === 'Failed') (before === 'Failed' ? stillFailing : newFailures).push(test)
    else if (result === 'Passed' && before === 'Failed') fixed.push(test)
  }
  // Fewer tests than main means the run stopped partway, as when the app crashes: a test that
  // passed on main and never ran here counts as failing. A renamed test keeps the count.
  if (branch.size < main.size) {
    for (const [test, before] of main)
      if (before === 'Passed' && !branch.has(test)) newFailures.push(`${test} (did not run)`)
  }

  return { newFailures: newFailures.sort(), stillFailing: stillFailing.sort(), fixed: fixed.sort() }
}

export function summary({ newFailures, stillFailing, fixed }, total) {
  const list = (title, tests) =>
    tests.length
      ? [`**${title} (${tests.length})**`, ...tests.map((test) => `- \`${test}\``), '']
      : []

  const verdict = newFailures.length ? `${newFailures.length} new failures.` : 'No new failures.'

  return [
    `${total} tests ran. ${verdict}`,
    '',
    ...list('New failures: passed on main', newFailures),
    ...list('Also failing on main', stillFailing),
    ...list('Fixed: failing on main, passing here', fixed),
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [branchFile, mainFile] = process.argv.slice(2)
  const branch = results(JSON.parse(readFileSync(branchFile, 'utf8')))
  const main = results(JSON.parse(readFileSync(mainFile, 'utf8')))
  const outcome = compare(branch, main)
  const text = summary(outcome, branch.size)

  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  // No results at all means the tests never ran, which must not pass as "no new failures".
  if (branch.size === 0 || outcome.newFailures.length > 0) process.exit(1)
}
