import { describe, expect, it } from 'vitest';
import { parseSharePointLink } from '@/lib/graph/discover';
import { LOCATION_KEYS, locationFromSettings } from '@/lib/graph/location';

describe('parseSharePointLink', () => {
  it('reads the folder from a library view address', () => {
    expect(
      parseSharePointLink(
        'https://contoso.sharepoint.com/sites/Clients/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FClients%2FShared%20Documents%2FClient%20Folders&viewid=abc',
      ),
    ).toEqual({
      host: 'contoso.sharepoint.com',
      path: '/sites/Clients/Shared Documents/Client Folders',
      sitePath: '/sites/Clients',
    });
  });

  it('reads a plain folder address and Teams sites', () => {
    expect(
      parseSharePointLink('https://contoso.sharepoint.com/teams/QH/Documents/Clients/'),
    ).toEqual({
      host: 'contoso.sharepoint.com',
      path: '/teams/QH/Documents/Clients',
      sitePath: '/teams/QH',
    });
    expect(
      parseSharePointLink('https://contoso.sharepoint.com/Shared%20Documents/Clients').sitePath,
    ).toBe('');
  });

  it('rejects other hosts, plain http and sharing links', () => {
    expect(() => parseSharePointLink('https://evil.example/sites/x')).toThrow();
    expect(() => parseSharePointLink('http://contoso.sharepoint.com/sites/x')).toThrow();
    expect(() => parseSharePointLink('https://contoso.sharepoint.com/:f:/s/Clients/EaBcD')).toThrow(
      /sharing link/,
    );
    expect(() => parseSharePointLink('not a url')).toThrow();
  });
});

describe('locationFromSettings', () => {
  const rows = [
    { key: LOCATION_KEYS.siteId, value: 'contoso.sharepoint.com,a,b' },
    { key: LOCATION_KEYS.driveId, value: 'b!drive' },
    { key: LOCATION_KEYS.rootFolderId, value: '01ROOT' },
    { key: LOCATION_KEYS.hostname, value: 'contoso.sharepoint.com' },
    { key: LOCATION_KEYS.folderPath, value: 'Documents/Clients' },
  ];

  it('builds the location when the three IDs are present', () => {
    expect(locationFromSettings(rows)).toMatchObject({
      siteId: 'contoso.sharepoint.com,a,b',
      driveId: 'b!drive',
      rootFolderId: '01ROOT',
      hostname: 'contoso.sharepoint.com',
      folderPath: 'Documents/Clients',
      siteName: null,
    });
  });

  it('is null when any ID is missing or blank', () => {
    expect(locationFromSettings(rows.filter((r) => r.key !== LOCATION_KEYS.driveId))).toBeNull();
    expect(
      locationFromSettings(
        rows.map((r) => (r.key === LOCATION_KEYS.rootFolderId ? { ...r, value: ' ' } : r)),
      ),
    ).toBeNull();
    expect(locationFromSettings([])).toBeNull();
  });
});
