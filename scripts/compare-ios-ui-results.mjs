// Compares a pull request's iOS UI test results with main's latest nightly run, both as written by
// `xcrun xcresulttool get test-results tests`. A new failure is a test that fails here and passed
// on main, or that the pull request's own diff writes; only those fail the pull request.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
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

/** `apps/ios/UITests/DockPanelUITests.swift` holds `DockPanelUITests/testClosingATab()`. */
const fileSuite = (path) => path.replace(/^.*\/|\.swift$/g, '')
const testSuite = (test) => test.split('/')[0]
const testName = (test) => test.split('/')[1]?.replace(/\(.*$/, '') ?? test

export function compare(branch, main, changedFiles = [], treeTests = null) {
  const changed = new Set(changedFiles.map(fileSuite))
  const newFailures = []
  const newOnMain = []
  const notHereYet = []
  const stillFailing = []
  const fixed = []

  for (const [test, result] of branch) {
    const before = main.get(test)

    if (result === 'Failed') {
      if (before === 'Failed') stillFailing.push(test)
      // The baseline has no say on a test it predates, so only the diff that writes it is charged.
      else if (before === undefined && !changed.has(testSuite(test))) newOnMain.push(test)
      else newFailures.push(test)
    } else if (result === 'Passed' && before === 'Failed') fixed.push(test)
  }
  // Fewer tests than main means the run stopped partway, as when the app crashes: a test that
  // passed on main and never ran here counts as failing. A renamed test keeps the count.
  if (branch.size < main.size) {
    for (const [test, before] of main)
      if (before === 'Passed' && !branch.has(test)) {
        // A crashed app still leaves its tests in the tree; one the branch predates is not there.
        if (!treeTests || treeTests.has(testName(test))) newFailures.push(`${test} (did not run)`)
        else notHereYet.push(test)
      }
  }

  return {
    newFailures: newFailures.sort(),
    newOnMain: newOnMain.sort(),
    notHereYet: notHereYet.sort(),
    stillFailing: stillFailing.sort(),
    fixed: fixed.sort(),
  }
}

export function summary(
  { newFailures, newOnMain = [], notHereYet = [], stillFailing, fixed },
  total,
) {
  const list = (title, tests) =>
    tests.length
      ? [`**${title} (${tests.length})**`, ...tests.map((test) => `- \`${test}\``), '']
      : []

  const verdict = newFailures.length ? `${newFailures.length} new failures.` : 'No new failures.'

  return [
    `${total} tests ran. ${verdict}`,
    '',
    ...list('New failures: passed on main', newFailures),
    ...list('New on main since baseline, not blocking', newOnMain),
    ...list('Not on this branch yet, not blocking', notHereYet),
    ...list('Also failing on main', stillFailing),
    ...list('Fixed: failing on main, passing here', fixed),
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [branchFile, mainFile, ...changedFiles] = process.argv.slice(2)
  const branch = results(JSON.parse(readFileSync(branchFile, 'utf8')))
  const main = results(JSON.parse(readFileSync(mainFile, 'utf8')))
  // Which tests this checkout actually has, to tell a run that stopped partway from a branch
  // that simply predates a test the baseline already had.
  const dir = 'apps/ios/UITests'
  const treeTests = new Set()
  for (const file of readdirSync(dir))
    for (const [, name] of readFileSync(`${dir}/${file}`, 'utf8').matchAll(
      /\bfunc (test\w*)\s*\(/g,
    ))
      treeTests.add(name)
  const outcome = compare(branch, main, changedFiles, treeTests)
  const text = summary(outcome, branch.size)

  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  // No results at all means the tests never ran, which must not pass as "no new failures".
  if (branch.size === 0 || outcome.newFailures.length > 0) process.exit(1)
}
