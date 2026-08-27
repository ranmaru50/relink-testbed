# AGENTS.md

## Repository-wide rules

- Use TypeScript strict mode.
- Keep dependencies minimal and prefer Node.js built-in `node:http` for HTTP servers.
- Use ephemeral ports for automated tests and never require external network access.
- Keep the Entity, Capability, and Cross-Origin logical services separate.
- Keep fixtures and case definitions deterministic and runtime-independent.
- Verify server behavior with TDD and always close every server cleanly.
- Serve fixtures through an explicit registry; never resolve URL input directly as a file path.
- When changing documentation, including README files, update the English version as the canonical source first and update the corresponding Japanese version to match its content and structure.
