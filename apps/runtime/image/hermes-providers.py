# Writes hermes-providers.json, the providers hermes-login.mjs offers, from the installed
# Hermes: python -I hermes-providers.py > hermes-providers.json. The Hermes image build
# fails when the committed file no longer matches the pinned Hermes.
#
# OpenRouter is Hermes's default rather than a registry entry. Qwen OAuth only copies a
# Qwen CLI login from the same computer, and providers with an id of their own share a
# name with the first one.
import json

from hermes_cli.auth import PROVIDER_REGISTRY
from hermes_cli.auth_commands import _OAUTH_ADD_SPECS
from hermes_cli.models import get_default_model_for_provider as model

out = [{"id": "openrouter", "name": "OpenRouter", "key": True, "oauth": True, "model": model("openrouter")}]
names = {"OpenRouter"}
for id, provider in PROVIDER_REGISTRY.items():
    oauth = id == "nous" or (id in _OAUTH_ADD_SPECS and id != "qwen-oauth")
    if provider.name in names or not (oauth or provider.auth_type == "api_key"):
        continue
    names.add(provider.name)
    out.append({"id": id, "name": provider.name, "key": provider.auth_type == "api_key",
                "oauth": oauth, "model": model(id)})
print(json.dumps(out, indent=2))
