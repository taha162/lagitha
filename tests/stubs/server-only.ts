// The real `server-only` package throws on import to stop server modules being
// pulled into a client bundle. Under Vitest we are already in Node, so the
// guard has nothing to protect and is replaced with this no-op.
export {};
