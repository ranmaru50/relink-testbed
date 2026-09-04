<!-- docs/resolver-http-security-headers-0.1.md -->

# Resolver HTTP Security Headers 0.1

This repository contains a Testbed-side acceptance runner for the protocol-visible HTTP hardening added to the Reference Resolver. It is separate from both the frozen Resolver / Manifest Conformance Catalog 0.1 and the administrative authentication acceptance runner.

The runner uses a Node.js HTTP client that retains `IncomingMessage.rawHeaders`. Header names are compared case-insensitively, while field multiplicity remains observable. A comma-combined value is not treated as equivalent to two expected single fields.

## Checks

For every applicable response the runner records the raw status, normalized headers, raw header fields, and body. It checks the following:

- exactly one `X-Content-Type-Options: nosniff` field;
- `Server` is absent or uses the fixed neutral token `relink` / `relink-resolver`, with no Apache/PHP version or host disclosure, and no `X-Powered-By` field;
- `Strict-Transport-Security: max-age=31536000` on HTTPS and no HSTS on HTTP/development responses;
- `Cache-Control: no-store` and the required `Content-Security-Policy` directives on administrative responses;
- public CORS and `Referrer-Policy: no-referrer`; and
- rejection of `TRACE` with HTTP 405.

Native scenarios cover HTTPS public Resolver, Manifest, administrative login, an Apache error path, TRACE, redirect, 4xx, optional 5xx, and an HTTP development response. Manifest receives only the common hardening checks; Resolver public CORS / Referrer-Policy checks are not applied to it. Container scenarios retain reproducible 400, 503, administrative 200, TRACE 405, and optional successful/redirect checks.

## Run

Configure each transport explicitly. `RELINK_NATIVE_URL` and `RELINK_CONTAINER_URL` remain accepted as a fallback for one transport, but production acceptance should use the explicit variables below.

```powershell
$env:RELINK_SECURITY_NATIVE_HTTPS_URL = "https://native.example"
$env:RELINK_SECURITY_NATIVE_HTTP_URL = "http://127.0.0.1:8081"
$env:RELINK_SECURITY_CONTAINER_HTTP_URL = "http://127.0.0.1:8080"
$env:RELINK_SECURITY_NATIVE_5XX_URL = "https://native.example/security/503"
$env:RELINK_SECURITY_CONTAINER_5XX_URL = "http://127.0.0.1:8080/security/503"
pnpm security:headers
```

Results are written independently to `reports/security-headers-0.1/native.json` and `reports/security-headers-0.1/container.json`. A missing HTTPS/HTTP endpoint is `NOT-APPLICABLE`; an optional 5xx endpoint that is not configured is `UNSUPPORTED-OPTIONAL`. Neither status asserts that a deployment passed.

The runner does not import Resolver code, inspect configuration or databases, follow redirects, fetch Description Locations, or execute capabilities. The acceptance result is based only on the final wire response from the configured deployment.
