# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately via one of:

1. **GitHub Security Advisory** (preferred): use the
   ["Report a vulnerability" button](https://github.com/kevinzezel/pulse/security/advisories/new)
   on the Security tab. This creates a private thread with the maintainer.
2. **Email**: `kevin@adsscanner.com` with subject line starting with `[pulse-security]`.

Include as much of the following as possible:

- The version of Pulse affected
- A description of the vulnerability and its impact
- Steps to reproduce (minimal PoC preferred)
- Any mitigations you've already identified

## What to expect

- Acknowledgement within **72 hours**.
- An initial triage and severity assessment within **7 days**.
- A fix or mitigation plan within **30 days** for high/critical issues.
- Public disclosure **after** a fix is available, coordinated with you.

## Scope

This policy covers the Pulse client, dashboard (frontend), installer, and distributed release artifacts. Out of scope:

- Issues in third-party dependencies (report upstream, we'll update when patched).
- Self-hosted deployment misconfigurations (e.g., exposing the client to the public internet without a reverse proxy + TLS).

## Supported versions

Only the **latest** stable release receives security fixes. The project is currently in its early public stage — if you're running something older, upgrade first:

```bash
pulse upgrade
```

## Safe harbor

Security research conducted in good faith — testing on your own self-hosted install, avoiding access to data that isn't yours, and disclosing responsibly — is welcome and appreciated. We will not pursue legal action against researchers acting in good faith.
