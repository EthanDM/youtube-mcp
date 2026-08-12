# Security policy

Do not open public issues containing API keys, OAuth client credentials, access tokens, refresh tokens, or private playlist URLs.

For a potential security issue in this repository, use GitHub's private security-advisory reporting flow for the repository. Include the affected version, a minimal reproduction, and any relevant redactions. Do not include active credentials.

This project stores OAuth tokens locally. If credentials are exposed, revoke the affected Google credentials or token in Google Cloud, run `pnpm auth:logout`, and create replacement credentials before continuing.
