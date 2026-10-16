export function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const expected = process.env.APP_ORIGIN
    ? new URL(process.env.APP_ORIGIN).origin
    : new URL(request.url).origin;
  return origin === expected;
}
