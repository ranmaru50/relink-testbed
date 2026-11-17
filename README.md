# RELink Testbed

Local, automated test environment for validating **AR-XML runtimes** and future **RELink protocol components**.

RELink Testbed provides reproducible fixtures, protocol scenarios, and expected results that can be shared across multiple runtime implementations.

The initial focus is the **AR-XML Core 0.1 Draft 4 Web Runtime baseline**, while the architecture is intended to expand later to Resolver, Manifest, Trust, and additional runtime implementations.

---

## Purpose

RELink Testbed exists to answer a simple question:

> Does a RELink / AR-XML implementation behave consistently against the same observable test cases?

Rather than embedding all protocol tests inside one runtime repository, this project provides an independent environment that can be reused by:

- Web runtimes
- Python runtimes
- Kotlin / mobile runtimes
- .NET runtimes
- future headless, embedded, or robotics runtimes

The goal is not to reproduce every production deployment detail.

The goal is to provide a **small, deterministic, locally runnable environment** for protocol, semantic, and interoperability testing.

---

## Initial Scope

The first version targets the AR-XML Core 0.1 Draft 4 processing baseline:

```text
Fetch
→ Parse
→ Validate
→ Resolve
→ Evaluate
→ Invoke
→ Decode
→ Map
→ Expose Result
```

The environment should support scenarios for:

- AR-XML document retrieval
- valid and malformed XML
- Core structure validation
- relative endpoint resolution
- HTTP GET input serialization
- HTTP POST JSON serialization
- HTTP 2xx behavior
- HTTP 204 behavior
- JSON result decoding
- text result decoding
- binary/media result handling
- single-output mapping
- multi-output JSON mapping
- malformed responses
- incorrect `Content-Type`
- delayed responses
- cancellation
- Runtime network-policy behavior
- cross-origin scenarios
- CORS behavior in real browsers
- layered error classification
- Contract / Projection / Availability states

---

## External Web Runtime Test Harness

An external browser-based Harness may use this Testbed without importing it into a Runtime. The Harness loads machine-readable case metadata, gives the AR-XML document URL to a Runtime, and reads passive request observations after the user invokes a Capability.

```text
Browser Harness
   │
   ├─ Web Runtime
   │      │
   │      └── AR-XML / Capability HTTP ──┐
   │                                      │
   └── Diagnostic API ────────────────────┤
                                          ▼
                                     RELink Testbed
```

Start the Testbed with `pnpm dev`. It uses ephemeral localhost ports and prints the Entity, Cross-Origin, and diagnostic URLs. The Testbed never executes a Runtime or requests Runtime-specific result reports.

Diagnostic endpoints are available under `/__testbed/*` on the Entity Origin:

- `GET /__testbed/info`
- `GET /__testbed/cases`
- `GET /__testbed/cases/{id}`
- `GET /__testbed/requests`
- `GET /__testbed/requests/{endpointId}`
- `POST /__testbed/reset`

These diagnostics, baseline AR-XML documents, and baseline Harness Capability endpoints are browser-readable with permissive CORS. Capability CORS behavior remains scenario-specific; dedicated denied scenarios are not made permissive.

Currently supported Harness cases are `single-output-json`, `multi-output-json`, `post-json`, `http-204-no-output`, `relative-endpoint-invocable`, `http-500`, and `malformed-json`. Their runtime-independent metadata is stored in `cases/**/*.json`.

## Resolver / Manifest conformance

The executable Resolver / Manifest 0.1 runner is documented in [docs/resolver-conformance-0.1.md](docs/resolver-conformance-0.1.md). It runs target-specific cases against separately configured Native and Container profiles, records raw HTTP observations, and writes normalized JSON results without collapsing targets into an overall Resolver result.

Administrative authentication security acceptance is implemented and documented in [docs/admin-security-acceptance-0.1.md](docs/admin-security-acceptance-0.1.md). It separately records Native and Container observations for login throttling, session controls, CSRF, cookie attributes, trusted proxy metadata, and optional Resolver-side SQLite evidence without adding cases to the frozen catalog. Repository implementation completion remains distinct from live deployment acceptance.

Resolver HTTP security-header acceptance runner is implemented, reviewed, and documented in [docs/resolver-http-security-headers-0.1.md](docs/resolver-http-security-headers-0.1.md). It keeps raw status and header fields, including duplicate fields, and verifies Native HTTPS/HTTP scoping plus Container error, administrative, TRACE, and representative redirect scenarios. Run it with `pnpm security:headers` against explicitly configured deployment endpoints. Live Native HTTPS / Container acceptance and raw observation artifact commits remain a separate open deployment task.

## Resolver L2 conformance

The Resolver L2 0.1-draft conformance suite lives under `src/conformance/l2/`. It covers 91 catalog cases
(`L2_CONFORMANCE_CATALOG_VERSION = "0.1-draft"`) across four targets: `L2-SERVER`, `L2-PRODUCER`, `L2-VERIFIER`,
and `L2-AUTHORITY`. The L1 catalog remains frozen; the L2 catalog is a separate file and the L1 `pnpm conformance`
entrypoint is unchanged.

Pinned fixtures: `src/conformance/l2/fixtures/l2-fixtures.json` carries the 28 pinned canonical payload vectors,
five ed25519 key pairs (seed strings derive the PKCS#8 seeds deterministically), and the fixed clock
(T = 1769998400, W = 600). Fixtures are runtime-independent: every canonical string, signature, and keyId re-derives
byte-for-byte, and the suite never re-signs or modifies a pinned vector.

The verifier implements phases 1–11 of §15.2: wire canonicality and strict parse, anchor binding, algorithm,
trusted clock, chain walk (§9.6, including the §12.2 transfer trail), revocation snapshot, Record chain position,
signature over the canonical payload bytes, key state (§9.5), freshness, floor, and replay, and the L1-bound
observation (§7.4). Negative Record and statement variants are built by canonical-preserving string surgery on the
pinned vectors, or by re-signing a mutated payload with a fixture seed.

Run the suite:

```bash
pnpm tsx src/conformance/l2/run.ts
```

It writes `reports/resolver-l2-0.1-draft/<profile>.json`. With no deployment URL configured, the runner uses the
offline stub Resolver server (`node:http`, ephemeral port, explicit fixture registry, closed cleanly) for the
L2-SRV cases. To point the L2-SRV handlers at a real deployment, set `RELINK_NATIVE_URL` (profile `native`) or
`RELINK_CONTAINER_URL` (profile `container`) in the environment; the same runner and the same 91 handlers then
drive the real base URL, exactly as the L1 runner does through `src/conformance/profiles.ts`.

`pnpm test` runs the L2 vitest suites under `tests/conformance/`: fixtures self-consistency, L2-VER, L2-AUT,
L2-PRO, L2-SRV, and the coverage test, which asserts that every one of the 91 catalog case ids is covered by a
test title naming it and that the coverage map contains no unknown ids. The coverage map is
`tests/conformance/l2-coverage.ts`.

Known baseline deviations are recorded in the report: ES256 support (L2-PRO-012) and statement revocation
(L2-VER-045) are `UNSUPPORTED-OPTIONAL`, and a deployment that omits the SHOULD-level
`Referrer-Policy: no-referrer` header is recorded as `PASS-WITH-DEVIATION` (L2-SRV-006).

---

## Design Goals

### Local First

The complete baseline environment should run on a developer machine without requiring an external cloud service.

A typical workflow should be as simple as:

```bash
pnpm install
pnpm test
```

The test runner should be able to start and stop required local servers automatically.

### Deterministic

Test cases should produce repeatable behavior and avoid public APIs, third-party services, unstable external networks, or shared remote state.

### Runtime Independent

Fixtures and expected results should not depend on TypeScript or a particular runtime API.

The same scenario should eventually be reusable by:

```text
Web Runtime
Python Runtime
Kotlin Runtime
.NET Runtime
```

### Protocol Focused

The testbed should verify externally observable protocol and semantic behavior rather than internal implementation structure.

### Extensible

The initial AR-XML test server should be able to grow into a broader RELink protocol test environment without requiring a complete redesign.

---

## Proposed Architecture

```text
RELink Testbed
│
├─ Test Runner
│
├─ Entity Server
│  ├─ AR-XML fixtures
│  └─ document retrieval scenarios
│
├─ Capability Server
│  ├─ success responses
│  ├─ error responses
│  ├─ malformed responses
│  ├─ delayed responses
│  └─ request inspection
│
├─ Cross-Origin Server
│  └─ CORS / origin scenarios
│
├─ Test Cases
│  ├─ input
│  ├─ expected request
│  ├─ expected runtime state
│  └─ expected result / error
│
└─ Future Services
   ├─ Resolver
   ├─ Manifest
   ├─ Trust
   └─ Identity scenarios
```

The initial implementation may run several logical services inside one Node.js process, but they should remain logically separated. Different ephemeral ports can be used to create independent origins.

---

## Test Server Strategy

The initial implementation should prefer the built-in Node.js HTTP server rather than a full application framework.

This gives direct control over:

- response status
- headers
- malformed bodies
- delayed responses
- connection termination
- redirects
- CORS headers
- request recording

Example logical origins:

```text
Origin A
Entity / AR-XML documents

Origin B
Cross-origin capability endpoint

Origin C
Future Resolver service
```

Ports should normally be allocated dynamically by the operating system to reduce conflicts and improve parallel test execution.

---

## Test Case Model

Test cases should be machine-readable wherever practical.

A conceptual example:

```json
{
  "id": "single-output-json",
  "document": "/arxml/single-output-json.arxml",
  "expected": {
    "contractResolution": "UNRESOLVED",
    "projectionValidation": "UNVALIDATED",
    "availability": "READY",
    "invocation": {
      "status": "success",
      "representation": "application/json",
      "values": {
        "temperature": 20.1
      }
    }
  }
}
```

The exact schema is not yet fixed. A test case should describe expected observable behavior rather than private implementation details.

---

## Suggested Scenario Groups

```text
cases/
├─ document/
│  ├─ valid
│  ├─ malformed-xml
│  └─ invalid-arxml
├─ request/
│  ├─ get-query
│  ├─ post-json
│  └─ relative-endpoint
├─ response/
│  ├─ single-output-json
│  ├─ multi-output-json
│  ├─ text
│  ├─ binary
│  ├─ no-content
│  ├─ malformed-json
│  └─ wrong-content-type
├─ http/
│  ├─ 400
│  ├─ 401
│  ├─ 403
│  ├─ 404
│  └─ 500
├─ runtime/
│  ├─ abort
│  ├─ unresolved-contract
│  └─ projection-conflict
└─ security/
   ├─ same-origin
   ├─ cross-origin-allowed
   └─ cross-origin-denied
```

This structure is illustrative and may change as the project is implemented.

---

## Browser-Specific Verification

Node.js HTTP clients do not enforce browser CORS rules.

Therefore, browser-specific security behavior should be tested separately using a real browser environment.

A future browser verification layer may use Playwright for cases such as:

- CORS rejection
- preflight behavior
- browser credential policy
- browser fetch behavior

Most protocol and semantic tests should remain runnable without launching a browser.

---

## Future Resolver Testing

Resolver testing is expected to use the same testbed.

```text
Anchor / Identifier
       ↓
Resolver Service
       ↓
Entity Identity / AR-XML Location
       ↓
AR-XML Runtime
       ↓
Capability Invocation
```

Resolver should remain a separate logical service from the AR-XML Runtime and Entity server.

Possible future scenarios include successful resolution, unknown entities, stale mappings, moved AR-XML documents, lifecycle state, resolver failure, cache behavior, manifest discovery, and trust metadata.

More deployment-oriented scenarios such as real DNS, TLS certificate chains, NFC, BLE, or network failover may require additional environments later.

---

## Relationship to Runtime Repositories

RELink Testbed is not a runtime implementation.

It provides shared external test scenarios that runtime repositories can execute against.

Over time, the same fixtures and expected results may form the basis of an **AR-XML Conformance Test Suite**.

---

## Non-Goals

The initial version is not intended to provide:

- production hosting
- performance benchmarking
- internet-scale Resolver infrastructure
- certification services
- public interoperability infrastructure
- hardware simulation
- full network-failure emulation
- complete TLS / PKI testing
- NFC / BLE hardware testing

Those may be added as separate test layers if required.

---

## Project Status

**Experimental / Early Development**

The project is being created alongside AR-XML Core and RELink runtime development.

Test schemas, directory structure, server APIs, and scenario definitions may change while the specification is still evolving.

---

## License

License to be defined by the repository owner.

If this project is released alongside other RELink runtime implementations, Apache License 2.0 is a suitable default for implementation code.

---

## RELink

RELink stands for **Real Entity Link**.

The broader goal is to make real-world entities:

```text
Addressable
→ Discoverable
→ Interactable
→ Operable
```

using existing Web infrastructure wherever practical.

RELink Testbed provides the shared experimental environment used to verify that architecture.
