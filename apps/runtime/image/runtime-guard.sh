# Sourced by every non-interactive bash through BASH_ENV (set in the runtime
# ConfigMap). Not executable on its own.

# The conversation token in the spawn-time env expires; OpenAB rewrites the
# current one into OPENAB_CREDENTIALS_DIR on every turn and deletes a revoked
# one, so a missing file must unset the stale value. Nested shells re-read it
# too.
if [ -n "${OPENAB_CREDENTIALS_DIR:-}" ]; then
  for nuphos_credential in NUPHOS_TOKEN NUPHOS_PLAN_API_TOKEN; do
    nuphos_credential_value=
    if [ -r "$OPENAB_CREDENTIALS_DIR/$nuphos_credential" ]; then
      IFS= read -r nuphos_credential_value <"$OPENAB_CREDENTIALS_DIR/$nuphos_credential" || true
    fi
    if [ -n "$nuphos_credential_value" ]; then
      export "$nuphos_credential=$nuphos_credential_value"
    else
      unset "$nuphos_credential"
    fi
  done
  unset nuphos_credential nuphos_credential_value
fi
