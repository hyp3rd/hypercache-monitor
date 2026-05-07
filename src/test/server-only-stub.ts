// Empty stub for `server-only` in the Vitest environment.
//
// Next.js's `import "server-only"` is a compile-time guard that
// errors at build time if the module ends up in the client
// bundle. Vitest doesn't run the Next.js compiler, so the import
// resolves to this no-op and tests can exercise server-only code
// (the proxy, the session helpers, the registry) without
// fighting the guard.
//
// Wired via `vitest.config.ts`'s `resolve.alias["server-only"]`.

export {};
