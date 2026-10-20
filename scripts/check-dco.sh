#!/usr/bin/env bash
# Fails if any non-merge commit in the range lacks a DCO sign-off that matches
# its author exactly. See DCO and CONTRIBUTING.md.
#
#   scripts/check-dco.sh <base-rev> <head-rev>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <base-rev> <head-rev>" >&2
  exit 2
fi

base="$1"
head="$2"
status=0
checked=0
while read -r sha; do
  checked=$((checked + 1))
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  if ! git log -1 --format='%B' "$sha" | grep -qxF "Signed-off-by: $author"; then
    echo "error: $(git log -1 --format='%h %s' "$sha")" >&2
    echo "       is missing 'Signed-off-by: $author' (see CONTRIBUTING.md)" >&2
    status=1
  fi
done < <(git rev-list --no-merges "$base..$head")

if [[ $status -eq 0 ]]; then
  echo "All $checked commit(s) carry a sign-off matching their author."
fi
exit $status
