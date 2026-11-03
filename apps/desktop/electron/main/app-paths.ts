import path from 'node:path'

import { app } from 'electron'

import { APP_NAME, isDev } from './env'
import { resolveUserData } from './user-data'

// main.ts imports this first. Other modules read userData while they load
// (local-runtime builds its Mac screen helper from it), so the name and path
// must be final before any of them is evaluated.
app.setName(APP_NAME)

const appData = app.getPath('appData')

app.setPath('userData', isDev ? path.join(appData, APP_NAME) : resolveUserData(appData, APP_NAME))
