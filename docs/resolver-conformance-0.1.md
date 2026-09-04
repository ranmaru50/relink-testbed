# Resolver / Manifest Conformance Runner 0.1

This repository contains the executable Testbed-side runner for the frozen Resolver / Manifest Conformance Catalog 0.1. The runner tests the externally observable public Resolver, public Manifest endpoint, and authenticated maintenance surface. It never imports or executes Resolver PHP code and never infers conformance from SQLite state.

The pinned implementation under test is `ranmaru50/relink-resolver` commit `4b08eead4bcc23374044bb60340bb915102a29db`. Native and Container are separate profiles, but both use the same runner and normalized result model.

## Run

Start clean Native and Container deployments of the pinned Resolver. The administrative test account must be configured for each deployment. For local HTTP development profiles, enable the Resolver's explicit `RELINK_ADMIN_ALLOW_HTTP=1` setting; production deployments should use HTTPS at the deployment edge.

```powershell
$env:RELINK_NATIVE_URL = "http://127.0.0.1:8081"
$env:RELINK_CONTAINER_URL = "http://127.0.0.1:8080"
$env:RELINK_ADMIN_USERNAME = "admin"
$env:RELINK_ADMIN_PASSWORD = "replace-with-a-test-secret"
pnpm conformance
```

The runner provisions deterministic UUID fixtures through the authenticated admin form. Use a fresh database for a repeatable run; an existing fixture with a different state or Location is rejected rather than silently overwritten. Results are written separately to:

```text
reports/resolver-conformance-0.1/native.json
reports/resolver-conformance-0.1/container.json
```

Each result contains the catalog version, target, case ID, normative strength, result class, observed HTTP details, and the pinned Resolver commit. A case assigned to multiple targets expands to one result per `(caseId, target)` pair. There is no aggregate Resolver PASS/FAIL field.

## Scope and result interpretation

The runner executes the applicable server, endpoint, producer, lifecycle, cache, CORS, identifier, and Core/Manifest independence cases. Consumer-only cases (including redirect/network-policy enforcement, extensions, resource limits, schema semantics, and optional integrity verification) are emitted as `NOT-APPLICABLE` because the Reference Resolver is not the consumer under test. Duplicate-member parsing is also `NOT-APPLICABLE` for the consumer target, while the producer target checks the raw Manifest JSON before parsing it. This is a target boundary, not a failure.

`MNET-001` is `PASS` when the configured profile URL is HTTPS. A local HTTP profile is reported as `FAIL` because Manifest L1 retrieval is a catalog `MUST`; HTTPS termination must be part of the tested profile. `CACHE-002` is reported as `PASS-WITH-DEVIATION` when the profile does not use the catalog's default 60-second cache lifetime because that case is a `SHOULD`.

The runner uses manual redirect handling so raw status, `Location`, and cache/CORS headers remain observable. It does not follow Description Locations or perform capability execution. This preserves the Resolver/Runtime boundary and avoids treating a successful Resolver response as permission to fetch an Entity description.

The executable runner is unit-tested with injected/local HTTP clients. A Container execution artifact is committed at `reports/resolver-conformance-0.1/container.json`. Running the command against both profiles is an environment acceptance step and requires the pinned Resolver deployments; it does not require internet access after the deployments have been prepared. Native execution remains a separate environment acceptance step when Apache/PHP is available.
