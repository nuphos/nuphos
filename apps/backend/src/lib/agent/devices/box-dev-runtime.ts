/** Dev-only provisioning, before the first host starts. Never called by GET or resume. */
export const BOX_DEV_RUNTIME_COMMAND = String.raw`set -eu
umask 077
sha="$NUPHOS_BOX_RUNTIME_SHA256"
[ "$(printf '%s' "$sha" | wc -c)" -eq 64 ]
case "$sha" in *[!0-9a-f]*) exit 1 ;; esac
base="$HOME/.local/share/nuphos/box-runtime"
runtime="$base/$sha"
mkdir -p "$base"
if [ -e "$runtime" ]; then
  [ -s "$runtime/host.mjs" ] && [ -s "$runtime/manifest.json" ]
  [ "$(cat "$runtime/.archive-sha256")" = "$sha" ]
else
  staging=$(mktemp -d "$base/.stage.XXXXXXXX")
  trap 'rm -rf -- "$staging"' EXIT
  curl -fsSL --connect-timeout 5 --max-time 60 -o "$staging/runtime.tar.gz" -- "$NUPHOS_BOX_RUNTIME_URL"
  printf '%s  %s\n' "$sha" "$staging/runtime.tar.gz" | sha256sum -c -
  mkdir "$staging/unpacked"
  tar -xzf "$staging/runtime.tar.gz" -C "$staging/unpacked"
  [ -s "$staging/unpacked/host.mjs" ] && [ -s "$staging/unpacked/manifest.json" ]
  node -e 'const fs=require("node:fs"),p=require("node:path"),c=require("node:crypto"),d=process.argv[1],m=JSON.parse(fs.readFileSync(p.join(d,"manifest.json"))); if(!m.hostBuild?.capabilities?.includes("device-metrics-v1") || c.createHash("sha256").update(fs.readFileSync(p.join(d,"host.mjs"))).digest("hex")!==m.hostBuild.sha256) process.exit(1)' "$staging/unpacked"
  printf '%s\n' "$sha" > "$staging/unpacked/.archive-sha256"
  mv -T -- "$staging/unpacked" "$runtime"
fi
# Keep this Box on the same runtime after pause/resume; older Boxes have no pin.
ln -s "$sha" "$base/.current-$$"
mv -Tf -- "$base/.current-$$" "$base/current"`

/**
 * Starting or resuming reads an existing pin; it never stages or updates a runtime.
 * Only a staged, verified runtime is ever linked as current. The test names no host
 * file: the agent command's pgrep for the host would otherwise match its own shell.
 */
export const BOX_DEV_RUNTIME_ENV =
  'if [ -d "$HOME/.local/share/nuphos/box-runtime/current" ]; then export NUPHOS_LOCAL_RUNTIME_DIR="$HOME/.local/share/nuphos/box-runtime/current"; fi'
