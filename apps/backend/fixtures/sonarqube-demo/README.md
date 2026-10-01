# SonarQube isolated fixture

This directory is intentionally vulnerable test code. It exists only to verify
the SonarQube connector without granting a scanner access to a GitHub/GitLab
account or production repository.

Run it through the pinned helper from `apps/backend`:

```bash
export SONAR_HOST_URL=https://sonarqube.example.com
export SONAR_TOKEN=squ_...
bun run sonarqube:fixture
```

The helper mounts only this directory into the scanner container. It neither
clones a repository nor mounts the rest of the Nuphos workspace. The resulting
project key is `nuphos-sonarqube-isolated-fixture`; after analysis completes,
ask Nuphos to inspect that project through the SonarQube connector.

The token remains in the local environment for this development drill. Do not
commit it, paste it into chat, or reuse a production administrator token.
