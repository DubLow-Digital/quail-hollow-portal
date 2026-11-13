/**
 * End-to-end tests run the portal against a local stand-in for Microsoft Graph and
 * SharePoint (e2e-full/mock-graph.mjs), named by E2E_GRAPH_MOCK_URL. Only a plain-http
 * loopback address is accepted, so a stray setting can never send data anywhere: in a real
 * deployment nothing listens on the loopback interface. Unset in every real environment.
 *
 * No `server-only` here: the proxy reads it to allow the stand-in in the CSP.
 */
export function graphMockOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.E2E_GRAPH_MOCK_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return url.protocol === 'http:' && loopback ? url.origin : null;
  } catch {
    return null;
  }
}
