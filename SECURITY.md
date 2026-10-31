# Security policy

## Supported version

Security fixes are applied to the latest version on the default development branch.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose credentials, uploaded files, or paid-generation controls. Use GitHub's private vulnerability reporting for this repository. Include reproduction steps, affected endpoints, and the expected impact.

## Security boundaries

- Keep all provider keys in server-side environment variables.
- Treat uploads as untrusted raster images; SVG is intentionally rejected.
- Keep the application private until authentication, rate limiting, and tenant isolation are configured.
- Retain the server-side spending ceiling for every paid engine.
