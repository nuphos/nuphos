import path from 'node:path'

import { app } from 'electron'

import { APP_NAME, isDev } from './env.ts'
import { resolveUserData } from './user-data.ts'

import type { UserDataChoice } from './user-data.ts'

// `main.ts` imports this module first, and it has to stay first. Other modules read
// userData while they load — `local-runtime` builds its Mac screen helper from it — and
// reading it creates the directory, so the path set here is the one they all get. A
// reordered import would quietly hand them Electron's default name instead.
// `app-paths.test.ts` fails if that import moves.
app.setName(APP_NAME)

const appData = app.getPath('appData')

// A dev build sits beside the installed app on the same machine, so it keeps a profile of
// its own and never reads or writes the installed app's data, legacy name or not.
const choice: UserDataChoice = isDev
  ? { dir: path.join(appData, APP_NAME), leftAlone: null }
  : resolveUserData(appData, APP_NAME)

app.setPath('userData', choice.dir)

/** Where this build keeps its data, for the modules that would otherwise read the path. */
export const userDataDir = choice.dir

/** A directory holding a profile this build deliberately does not use. Reported, never deleted. */
export const leftAloneDir = choice.leftAlone

// Once per launch: which directory this build uses, and a profile it found beside it and
// deliberately left alone, so a question about an install's data has an answer.
if (choice.leftAlone)
  console.warn(
    `[user-data] using ${choice.dir}, and ${choice.leftAlone} holds a profile too; it is left as it is`,
  )
else console.log(`[user-data] using ${choice.dir}`)
