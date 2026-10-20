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

# Dependabot authors with its noreply address but signs off with this one.
dependabot="dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>"
dependabot_signoff="dependabot[bot] <support@github.com>"

# Listed before the loop so a bad revision fails the check instead of
# checking nothing.
commits="$(git rev-list --no-merges "$1..$2")"

status=0
checked=0
for sha in $commits; do
  checked=$((checked + 1))
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  signoff="$author"
  if [[ "$author" == "$dependabot" ]]; then
    signoff="$dependabot_signoff"
  fi
  if ! git log -1 --format='%B' "$sha" | grep -qxF "Signed-off-by: $signoff"; then
    echo "error: $(git log -1 --format='%h %s' "$sha")" >&2
    echo "       is missing 'Signed-off-by: $signoff' (see CONTRIBUTING.md)" >&2
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  echo "All $checked commit(s) carry a sign-off matching their author."
fi
exit $status
