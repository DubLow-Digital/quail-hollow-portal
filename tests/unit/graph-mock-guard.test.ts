import { describe, expect, it } from 'vitest';
import { graphMockOrigin } from '@/lib/graph/mock';
import { buildContentSecurityPolicy } from '@/lib/security/csp';

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA==';

describe('end-to-end Graph stand-in guard', () => {
  it('is off unless set', () => {
    expect(graphMockOrigin({})).toBeNull();
  });

  it('accepts only plain-http loopback origins', () => {
    expect(graphMockOrigin({ E2E_GRAPH_MOCK_URL: 'http://127.0.0.1:4010' })).toBe(
      'http://127.0.0.1:4010',
    );
    expect(graphMockOrigin({ E2E_GRAPH_MOCK_URL: 'http://localhost:4010/x' })).toBe(
      'http://localhost:4010',
    );
    for (const bad of [
      'https://127.0.0.1:4010',
      'http://evil.example',
      'http://127.0.0.1.evil.example',
      'http://10.0.0.5:4010',
      'https://graph.microsoft.com',
      'not a url',
    ]) {
      expect(graphMockOrigin({ E2E_GRAPH_MOCK_URL: bad })).toBeNull();
    }
  });

  it('adds only a loopback test origin to the CSP', () => {
    const normal = buildContentSecurityPolicy({ nonce: NONCE, isDev: false });
    expect(normal).toContain('upgrade-insecure-requests');
    const withMock = buildContentSecurityPolicy({
      nonce: NONCE,
      isDev: false,
      testUploadOrigin: 'http://127.0.0.1:4010',
    });
    expect(withMock).toMatch(
      /connect-src 'self' https:\/\/\*\.sharepoint\.com http:\/\/127\.0\.0\.1:4010;/,
    );
    const ignored = buildContentSecurityPolicy({
      nonce: NONCE,
      isDev: false,
      testUploadOrigin: 'https://evil.example',
    });
    expect(ignored).not.toContain('evil.example');
    expect(ignored).toContain('upgrade-insecure-requests');
  });
});
