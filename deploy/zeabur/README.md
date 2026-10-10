# Zeabur template

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/H9M7E7)

Deploy the data stack with the button, then [deploy the runtime](https://zeabur.com/templates/AUECDT)
in a **different project**. Review the required email and domain inputs before deploying.

[`template.yaml`](template.yaml) deploys three services: authenticated
single-node MongoDB, RustFS and the released backend. Deploy
[`runtime-template.yaml`](runtime-template.yaml) in a **different Zeabur project**
for the Claude Code runtime. This keeps the agent away from the data project
network and its shared database, storage and email credentials.
Redis is intentionally absent, matching the default local Compose stack.

The template uses [Zeabur's template format](https://zeabur.com/docs/en-US/template/template-format)
and the [official schema](https://schema.zeabur.app/template.json).

Deployment inputs:

- Two domains for the backend and storage; one more for the separate runtime. Zeabur supplies their HTTPS URLs.
- A Zeabur Email API key (`ZSEND_API_KEY`) and a sender on a verified domain
  (`NUPHOS_EMAIL_FROM`). Production sign-in sends email; it never logs OTP codes.
- An amd64 server for the runtime image, and your own Claude account after deployment.

The template README contains Desktop sign-in and runtime pairing steps. The
runtime console uses a generated password, available in its service connection
instructions. MongoDB public TCP forwarding is disabled. Presigned file URLs use
the public HTTPS storage endpoint, so no hosts-file modification is required.

Keep the generated secrets and volumes across redeploys. This is a single-replica
setup, with no Redis-backed cron, background thread queues or journal sealing.
Backend model features and Kubernetes-managed agents require separate configuration.

## Validation

```sh
python3 -m pip install PyYAML==6.0.3 jsonschema==4.26.0
python3 deploy/zeabur/check.py
# Requires Docker; runs the template's exact Mongo startup script and tests
# authenticated transactions before and after restart, then removes its container.
python3 deploy/zeabur/check.py --mongo
```

CI validates both official schemas, the separation of service/variable sets, and Mongo bootstrap. It does not provision a
Zeabur project or test domain binding, email delivery or model inference.
