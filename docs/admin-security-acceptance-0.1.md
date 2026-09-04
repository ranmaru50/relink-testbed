# Administrative Security Acceptance 0.1

This repository contains the Testbed-side acceptance runner for the Resolver administrative surface. It is separate from the frozen Resolver / Manifest Conformance Catalog 0.1; the `AUTH-*`, `SESSION-*`, `COOKIE-*`, `PROXY-*`, and `SQLITE-*` labels in this document are acceptance labels, not new frozen catalog case IDs.

The runner records Native and Container results independently. It observes the HTTP boundary and does not import Resolver PHP code, read the Resolver database to infer HTTP conformance, or add a Runtime dependency.

## Coverage

The HTTP cases cover:

- repeated failures from one IP, username changes after the first failure, lockout expiry, and recovery;
- a valid login from another IP; changing IPs as a distributed attack remains out of scope for this layer;
- normal login, session ID rotation, session fixation resistance, and CSRF token issuance;
- idle and absolute session expiry, including rejection of administrative page and mutation requests;
- `Secure`, `HttpOnly`, and `SameSite=Strict` session cookie attributes; and
- trusted and untrusted proxy metadata.

`SQLITE-001` consumes an optional JSON evidence file produced by the Resolver-side real SQLite acceptance tests. It requires the following boolean members to be `true`:

```json
{
  "concurrentAttempts": true,
  "expiredPurge": true,
  "boundedRows": true
}
```

This keeps the Testbed independent of SQLite implementation details while still recording the required Native/Container evidence when supplied. The case is `NOT-APPLICABLE` when no evidence file is configured.

## Run

Use a disposable Native and Container deployment with short security timeouts so the expiry cases are practical. The Resolver configuration and the runner values must match.

```powershell
$env:RELINK_NATIVE_URL = "http://127.0.0.1:8081"
$env:RELINK_CONTAINER_URL = "http://127.0.0.1:8080"
$env:RELINK_ADMIN_USERNAME = "admin"
$env:RELINK_ADMIN_PASSWORD = "replace-with-a-test-secret"
$env:RELINK_ADMIN_ALLOW_HTTP = "1"
$env:RELINK_ADMIN_LOGIN_MAX_FAILURES = "2"
$env:RELINK_ADMIN_LOGIN_LOCKOUT_SECONDS = "2"
$env:RELINK_ADMIN_SESSION_IDLE_SECONDS = "2"
$env:RELINK_ADMIN_SESSION_ABSOLUTE_SECONDS = "3"
$env:RELINK_SECURITY_NATIVE_UNTRUSTED_PROXY_URL = "http://127.0.0.1:8082"
$env:RELINK_SECURITY_CONTAINER_UNTRUSTED_PROXY_URL = "http://127.0.0.1:8083"
pnpm security:acceptance
```

Results are written separately to:

```text
reports/admin-security-0.1/native.json
reports/admin-security-0.1/container.json
```

The untrusted proxy URLs must reach the same deployment from an actually untrusted source. The runner cannot turn a client-supplied header into a different `REMOTE_ADDR`; if no such endpoint is configured, `PROXY-001` is recorded as `NOT-APPLICABLE` with the reason.

The timeout cases intentionally wait longer than the configured limits. Use disposable acceptance deployments and do not point this command at a production session store.
