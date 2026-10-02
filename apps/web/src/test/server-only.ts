// Vitest stand-in for the `server-only` package, which throws outside a React Server Component
// build. Server modules import it so Next.js refuses to bundle them for the browser.
export {};
