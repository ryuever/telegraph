# Runtime contracts compatibility

`@telegraph/runtime-contracts` is now a migration compatibility package.
The long-term protocol package is `@telegraph/agent-protocol`; this package
re-exports its public types for existing imports.

New code should import from `@/packages/agent-protocol` or
`@telegraph/agent-protocol`.
