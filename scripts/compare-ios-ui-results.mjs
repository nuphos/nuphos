// Compares a pull request's iOS UI test results with main's latest nightly run, both as written by
// `xcrun xcresulttool get test-results tests`. A new failure is a test that fails on the pull
// request and passed on main, or that the pull request adds; only those fail it.
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

/** The test functions (`testName`) a unified diff adds, whatever attributes precede `func`. */
export function addedTests(diff) {
  return new Set([...diff.matchAll(/^\+(?!\+\+).*\bfunc (test\w+)\(/gm)].map((match) => match[1]))
}

/** `added`: the test functions (`testName`) this pull request's own diff adds. */
export function compare(branch, main, added = new Set()) {
  const newFailures = []
  const stillFailing = []
  const fixed = []
  const notOnMain = []

  for (const [test, result] of branch) {
    const before = main.get(test)

    if (result === 'Passed' && before === 'Failed') fixed.push(test)
    if (result !== 'Failed') continue
    if (before === 'Failed') stillFailing.push(test)
    // Main has no such test: the branch's if it adds it, else taken from main after the nightly.
    else if (before === undefined && !added.has(test.split('/').at(-1).replace(/\(\)$/, '')))
      notOnMain.push(test)
    else newFailures.push(test)
  }
  // Fewer tests than main means the run stopped partway, as when the app crashes: a test that
  // passed on main and never ran here counts as failing. A renamed test keeps the count.
  if (branch.size < main.size) {
    for (const [test, before] of main)
      if (before === 'Passed' && !branch.has(test)) newFailures.push(`${test} (did not run)`)
  }

  return {
    newFailures: newFailures.sort(),
    stillFailing: stillFailing.sort(),
    fixed: fixed.sort(),
    notOnMain: notOnMain.sort(),
  }
}

export function summary({ newFailures, stillFailing, fixed, notOnMain = [] }, total) {
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
    ...list("Failing, not in main's nightly yet and not added here", notOnMain),
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [branchFile, mainFile] = process.argv.slice(2)
  const branch = results(JSON.parse(readFileSync(branchFile, 'utf8')))
  const main = results(JSON.parse(readFileSync(mainFile, 'utf8')))
  // The pull request's own diff: a test it took from main is not in it.
  const added = addedTests(readFileSync(process.env.PR_DIFF, 'utf8'))
  const outcome = compare(branch, main, added)
  const text = summary(outcome, branch.size)

  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  // No results at all means the tests never ran, which must not pass as "no new failures".
  if (branch.size === 0 || outcome.newFailures.length > 0) process.exit(1)
}
