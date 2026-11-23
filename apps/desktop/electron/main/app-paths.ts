import { app } from 'electron'

import { APP_NAME } from './env.ts'
import { LEGACY_USER_DATA_NAME, resolveUserData } from './user-data.ts'

// `main.ts` imports this module first, and it has to stay first. Other modules read
// userData while they load — `local-runtime` builds its Mac screen helper from it — and
// reading it creates the directory, so the path set here is the one they all get. A
// reordered import would quietly hand them Electron's default name instead.
// `app-paths.test.ts` fails if that import moves.
//
// Until it is set, Electron's name is the one in the build's own package.json: `k8s-gui` for the
// product and for dev, which run as APP_NAME. A build packaged with
// `--config.extraMetadata.productName=<name>` runs as that name instead, and so keeps a
// profile of its own beside the installed app (#4660).
const packagedName = app.getName()
const name = packagedName === LEGACY_USER_DATA_NAME ? APP_NAME : packagedName

app.setName(name)

const choice = resolveUserData(app.getPath('appData'), name)

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
