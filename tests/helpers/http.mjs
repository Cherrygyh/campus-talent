// Local workerd on Windows can reset a reused socket after rejecting a request
// before reading its body. Use separate HTTP connections for that test runtime.
// Linux CI keeps normal connection reuse; application code is unaffected.
export function localFetch(url, options = {}) {
  return globalThis.fetch(url, {
    ...options,
    headers: {
      ...(process.platform === 'win32' ? { Connection: 'close' } : {}),
      ...options.headers,
    },
  });
}
