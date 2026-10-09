import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { ESLint, Linter } from 'eslint'

// Resolve the shipped config, so a later override or missing file glob cannot
// silently disable the policy while the rule's isolated tests still pass.
const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, '..') })
const ruleIds = ['no-restricted-globals', 'no-restricted-properties'] as const

for (const file of [
  'src/App.tsx',
  'electron/main/updater.ts',
  'electron/preload.ts',
  'src/dialog.js',
]) {
  test(`native dialog policy is enforced for ${file}`, async () => {
    const config = await eslint.calculateConfigForFile(file)
    const rules = Object.fromEntries(ruleIds.map((id) => [id, config.rules[id]]))

    for (const id of ruleIds) assert.equal(config.rules[id][0], 2, id)
    const linter = new Linter()
    const lint = (code: string) =>
      linter.verify(code, {
        languageOptions: {
          globals: config.languageOptions.globals,
        },
        rules,
      })

    for (const code of [
      'alert("error")',
      'confirm("remove?")',
      'prompt("name")',
      'window.alert("error")',
      'globalThis.confirm?.("remove?")',
      'self["prompt"]("name")',
      'window.window.confirm("remove?")',
      'const ask = confirm; ask("remove?")',
      'const ask = window.confirm; ask("remove?")',
      'const { prompt: ask } = window; ask("name")',
      'import { dialog } from "electron"; dialog.showMessageBox({})',
      'import { dialog as native } from "electron"; native.showMessageBoxSync({})',
      'import * as electron from "electron"; electron.dialog.showErrorBox("error", "details")',
      'const native = require("electron").dialog; native["showMessageBox"]({})',
      'const { showMessageBox: show } = native; show({})',
      'const show = native.showErrorBox; show("error", "details")',
    ]) {
      const messages = lint(code)

      assert.ok(
        messages.some(
          (message) =>
            ruleIds.includes(message.ruleId as (typeof ruleIds)[number]) && message.severity === 2,
        ),
        code,
      )
      assert.ok(
        messages.some((message) => message.message.includes('Use ')),
        code,
      )
    }
    for (const code of [
      'function confirm() {} confirm()',
      'function run(prompt) { prompt() }',
      'const alert = () => {}; alert()',
      'service.confirm()',
      'toast.error("error")',
      'showAppDialog(parent, options)',
      'requireMainProcessConsent(sender, options)',
      'dialog.showOpenDialog({})',
      'dialog.showSaveDialog({})',
      'const example = "window.alert(1)"',
    ])
      assert.deepEqual(lint(code), [], code)
  })
}
