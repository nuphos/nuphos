# Local Box flow evidence

`NewBoxLiveBackendDeviceTest` is opt-in. Normal CI skips it. It uses the product
Computers & runtimes page and a real local backend/MongoDB. Only the instabox
HTTP edge and its machine are simulated; no shell command, provider sign-in,
real VM or paid order is executed.

1. Run `bun apps/android/scripts/box-instabox-edge.ts` from the repository root.
   It binds only to `127.0.0.1` and prints its address. The stub accepts a machine
   order, holds the host offline until `/test/ready`, then redeems the backend's
   real join token and opens the real runtime tunnel with a synthetic Codex
   status. Pause closes that tunnel; resume reconnects it. The stub never forwards
   requests to instabox. It logs methods and paths, not join tokens or credentials.
2. Start a local backend with a separate test database. Set `INSTABOX_API_URL` to
   that stub address, `INSTABOX_API_KEY` to a dummy test value and
   `NUPHOS_PUBLIC_BACKEND_URL` to the loopback backend address. Do not provide a
   production provider key. Create a synthetic administrator account/team and
   accept the current AI disclosure through the normal auth endpoints.
3. Write a private `new-box-live.json` outside Git with `token`, `teamId` and
   `stubUrl` for that synthetic account. Build both APKs with
   `-PnuphosIsolatedShareFixture=true` and
   `-PnuphosDebugApiBaseUrl=http://127.0.0.1:BACKEND_PORT`. Install them on an
   isolated emulator with the same debug key. Reverse both the backend and stub
   ports with `adb -s SERIAL reverse tcp:PORT tcp:PORT`.
4. Push the private config to
   `/sdcard/Android/data/ai.nuphos.android.shareinput1355/files/new-box-live.json`.
   Run `adb -s SERIAL shell am instrument -w -e class
   ai.nuphos.android.NewBoxLiveBackendDeviceTest
   ai.nuphos.android.shareinput1355.test/androidx.test.runner.AndroidJUnitRunner`
   as a single command. Set the app locale before running when captures in
   another language are needed.

The scenario drives create, starting, ready, pause and the product Resume action.
It records `BOX_ANDROID_*` signals in logcat and five `box-live-*.png` captures in
the app's external files directory. A successful run ends with `OK (1 test)` and
`BOX_ANDROID_RESUMED`; the final real inventory must say online/running.

Use an empty fixture team per run (the scenario uses `Android local Box`). Remove
that local synthetic Box through the backend's normal Box DELETE route after the
run, remove the private emulator config, and stop the backend/stub. Never use a
production team, production session or paid provider for this scenario. The test
itself refuses a non-loopback app build and a non-loopback stub address.
