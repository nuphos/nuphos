#!/bin/bash
# Runs inside a built runtime image as `node`:
#   docker run --rm -v "$PWD/test:/smoke:ro" --entrypoint bash <image> /smoke/image-smoke.sh [--tools]
set -euo pipefail

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

step 'gateway and agent'
openab --version
command -v "$OPENAB_AGENT_COMMAND"
case "$OPENAB_AGENT_COMMAND" in
  claude-agent-acp) claude --version ;;
  codex-acp) codex --version ;;
  *) fail "unexpected agent command $OPENAB_AGENT_COMMAND" ;;
esac
[ -z "$(ls /usr/local/lib/node_modules | grep -v -x -e npm -e corepack)" ] \
  || fail "globally installed npm packages: $(ls /usr/local/lib/node_modules)"
[ -z "$(find /opt -path '*claude-agent-sdk-linux-*-musl' -print -quit)" ] || fail 'musl CLI shipped'
[ ! -e /home/node/.npm ] || fail 'npm cache left in /home/node'

step 'built-in tools'
for tool in git gh jq rg curl python3 kubectl zeabur bwrap socat tini flock; do
  command -v "$tool" >/dev/null || fail "$tool missing"
done
python3 -m venv /tmp/venv-check && rm -rf /tmp/venv-check
nuphos-tools list

[ "${1:-}" = --tools ] || exit 0

export NUPHOS_TOOLS_DIR=${NUPHOS_TOOLS_DIR:-/home/node/.nuphos-runtime/tools}

timed() {
  local started=$SECONDS
  "$@"
  printf '(%ss)\n' $((SECONDS - started))
}

step 'archive tool: first use installs, concurrent callers share one install'
timed hcloud version &
timed hcloud version &
wait
[ "$(find "$NUPHOS_TOOLS_DIR/hcloud" -mindepth 1 -maxdepth 1 | wc -l)" = 1 ] || fail 'hcloud installed twice'
second=$(hcloud version 2>&1 >/dev/null)
[ -z "$second" ] || fail "a second call wrote to stderr: $second"
hcloud version | grep -qx 'hcloud [0-9.]*' || fail 'hcloud stdout carries installer output'

step 'Debian package tool'
timed psql --version

step 'C toolchain'
timed cc --version >/dev/null
work=$(mktemp -d)
cd "$work"
printf '#include <stdio.h>\n#include <math.h>\nint main(void){printf("%%.3f\\n", sqrt(2.0));return 0;}\n' > hello.c
printf '#include <iostream>\n#include <thread>\nint main(){std::thread t([]{});t.join();std::cout<<"c++ ok"<<std::endl;}\n' > hello.cc
printf 'all: hello hello-cc\nhello: hello.c\n\tcc -O2 -o $@ $< -lm\nhello-cc: hello.cc\n\tc++ -O2 -pthread -o $@ $<\n' > Makefile
make -s
[ "$(./hello)" = 1.414 ] || fail 'C program'
[ "$(./hello-cc)" = 'c++ ok' ] || fail 'C++ program'
echo 'toolchain ok'
