# Sidebar gesture bridge (macOS)

`sidebar-gestures.mm` observes this app's scroll-wheel phases and provides a midpoint haptic. It uses Node-API rather than Electron/V8 headers.

## Build and packaging

Install Desktop dependencies with `pnpm install --frozen-lockfile`. The `node-api-headers` dev dependency supplies the headers, with its version and integrity pinned in `pnpm-lock.yaml`. The build script resolves that installed package directly; it does not download headers or read a shared temporary cache.

The `sidebar-native-gestures` Vite `buildStart` plugin invokes `scripts/build-sidebar-gestures.ts` on macOS, using Xcode's `clang++` through `/usr/bin/xcrun`. It targets macOS 12.0, matching `build.mac.minimumSystemVersion` in `package.json`, and produces one universal arm64/x86_64 binary at `build/native/sidebar-gestures.node`.

- PR CI: the **Desktop (Nuphos macOS package)** job compiles it during **Build renderer and main bundles**, before `electron-builder` packages both architectures.
- Releases: the macOS jobs in `release-desktop.yml` compile it during **Build application**, before signing and notarization.
- `package.json` copies `build/native/*.node` into the application's `Resources/native` directory using `extraResources`. Build outputs remain ignored by Git. Concurrent builds compile in unique directories under `build/native` and atomically replace the final binary, so a dev watcher and a manual build do not share a linker output.

The script skips compilation on Linux and Windows. At runtime the main-process loader skips non-macOS hosts; if the binary cannot load on macOS, it logs a warning and the sidebar retains wheel/touch paging with the gesture quiet-timeout fallback, without native release events or haptics.
