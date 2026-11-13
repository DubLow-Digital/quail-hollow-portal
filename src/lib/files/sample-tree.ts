import {
  ExplorerAccessError,
  ROOT_LABEL,
  sortItems,
  type Crumb,
  type ExplorerItem,
  type FileSource,
} from './explorer-types';

/**
 * A made-up client folder tree for previewing the file browser before SharePoint is
 * connected (FILES_DEMO=true). Every name is obviously fake (CLAUDE.md rule 10) and there
 * are no file contents: downloads are disabled in this mode.
 */

type Node =
  | { name: string; folder: Node[]; by?: string; at?: string }
  | { name: string; size: number; by?: string; at?: string };

const PORTAL = 'Client portal';
const STAFF = 'Office staff';

function standard(
  last: string,
  first: string,
  year: number,
  files: { id?: Node[]; tax?: Node[]; income?: Node[] },
): Node {
  return {
    name: `${last}, ${first}`,
    folder: [
      {
        name: 'Individual',
        folder: [
          { name: 'ID', folder: files.id ?? [] },
          { name: 'Tax Returns', folder: [{ name: String(year), folder: files.tax ?? [] }] },
          {
            name: 'Income Documents',
            folder: [{ name: String(year), folder: files.income ?? [] }],
          },
        ],
      },
      { name: 'Businesses', folder: [] },
      { name: 'Dependents', folder: [] },
    ],
  };
}

const TREE: Node[] = [
  standard('Test', 'Todd', 2025, {
    id: [
      {
        name: 'TTest_DriversLicense_2026-11-12.pdf',
        size: 1_284_112,
        by: PORTAL,
        at: '2026-11-12T15:04:00Z',
      },
      {
        name: 'TTest_SocialSecurityCard_2026-11-12.jpg',
        size: 642_301,
        by: PORTAL,
        at: '2026-11-12T15:06:00Z',
      },
    ],
    tax: [
      {
        name: 'TTest_FederalReturn_2025_2026-11-12.pdf',
        size: 3_902_118,
        by: PORTAL,
        at: '2026-11-12T15:10:00Z',
      },
      {
        name: 'TTest_StateReturn_2025_2026-11-12.pdf',
        size: 1_120_004,
        by: PORTAL,
        at: '2026-11-12T15:11:00Z',
      },
    ],
    income: [
      {
        name: 'TTest_W2_2025_2026-11-12.pdf',
        size: 402_887,
        by: PORTAL,
        at: '2026-11-12T15:13:00Z',
      },
      {
        name: 'TTest_W2_2025_2026-11-12 1.pdf',
        size: 398_220,
        by: PORTAL,
        at: '2026-11-12T15:14:00Z',
      },
      {
        name: 'TTest_1099_2025_2026-11-13.pdf',
        size: 218_400,
        by: PORTAL,
        at: '2026-11-13T09:02:00Z',
      },
    ],
  }),
  standard('Sample', 'Sam', 2025, {
    id: [
      {
        name: 'SSample_DriversLicense_2026-10-30.jpg',
        size: 2_014_552,
        by: PORTAL,
        at: '2026-10-30T18:22:00Z',
      },
    ],
    income: [
      {
        name: 'SSample_BankStatement_2025_2026-11-01.pdf',
        size: 845_120,
        by: PORTAL,
        at: '2026-11-01T13:40:00Z',
      },
    ],
  }),
  {
    name: 'Example, Erin',
    folder: [
      {
        name: 'Individual',
        folder: [
          { name: 'ID', folder: [] },
          { name: 'Tax Returns', folder: [] },
          { name: 'Income Documents', folder: [] },
        ],
      },
      {
        name: 'Businesses',
        folder: [
          {
            name: 'Example Bakery LLC',
            folder: [
              {
                name: 'EExample_EINLetter_2026-09-14.pdf',
                size: 156_220,
                by: PORTAL,
                at: '2026-09-14T16:00:00Z',
              },
              {
                name: 'EExample_BusinessFormation_2026-09-14.pdf',
                size: 1_640_900,
                by: PORTAL,
                at: '2026-09-14T16:03:00Z',
              },
              {
                name: '2025',
                folder: [
                  {
                    name: 'Engagement letter (sample).docx',
                    size: 48_310,
                    by: STAFF,
                    at: '2026-09-10T12:00:00Z',
                  },
                ],
              },
            ],
          },
        ],
      },
      { name: 'Dependents', folder: [] },
    ],
  },
  {
    name: 'Office templates (sample)',
    folder: [
      { name: 'Organizer checklist.xlsx', size: 22_610, by: STAFF, at: '2026-08-01T12:00:00Z' },
    ],
  },
];

interface Indexed {
  item: ExplorerItem;
  children: string[];
  trail: Crumb[];
}

export const SAMPLE_ROOT_ID = 'sample.root';

function buildIndex(): Map<string, Indexed> {
  const index = new Map<string, Indexed>();
  index.set(SAMPLE_ROOT_ID, {
    item: {
      id: SAMPLE_ROOT_ID,
      name: ROOT_LABEL,
      kind: 'folder',
      size: null,
      childCount: TREE.length,
      mime: null,
      modifiedAt: null,
      modifiedBy: null,
      webUrl: null,
      parentId: null,
    },
    children: [],
    trail: [{ id: SAMPLE_ROOT_ID, name: ROOT_LABEL }],
  });
  let seq = 0;
  const walk = (nodes: Node[], parentId: string) => {
    const parent = index.get(parentId)!;
    for (const node of nodes) {
      const id = `sample.${++seq}`;
      const isFolder = 'folder' in node;
      index.set(id, {
        item: {
          id,
          name: node.name,
          kind: isFolder ? 'folder' : 'file',
          size: isFolder ? null : node.size,
          childCount: isFolder ? node.folder.length : null,
          mime: null,
          modifiedAt: node.at ?? '2026-11-01T12:00:00Z',
          modifiedBy: node.by ?? STAFF,
          webUrl: null,
          parentId,
        },
        children: [],
        trail: isFolder ? [...parent.trail, { id, name: node.name }] : parent.trail,
      });
      parent.children.push(id);
      if (isFolder) walk(node.folder, id);
    }
  };
  walk(TREE, SAMPLE_ROOT_ID);
  return index;
}

const INDEX = buildIndex();

function folderOrThrow(folderId: string): Indexed {
  const entry = INDEX.get(folderId);
  if (!entry || entry.item.kind !== 'folder') throw new ExplorerAccessError('not_found');
  return entry;
}

export const sampleSource: FileSource = {
  mode: 'sample',
  rootId: SAMPLE_ROOT_ID,

  async listFolder(folderId) {
    const entry = folderOrThrow(folderId || SAMPLE_ROOT_ID);
    return {
      id: entry.item.id,
      name: entry.item.name,
      trail: entry.trail,
      webUrl: null,
      items: sortItems(entry.children.map((id) => INDEX.get(id)!.item)),
      truncated: false,
    };
  },

  async search(folderId, query) {
    const needle = query.toLowerCase();
    const found: ExplorerItem[] = [];
    const visit = (id: string) => {
      for (const childId of INDEX.get(id)!.children) {
        const child = INDEX.get(childId)!;
        if (child.item.name.toLowerCase().includes(needle)) found.push(child.item);
        if (child.item.kind === 'folder') visit(childId);
      }
    };
    visit(folderOrThrow(folderId).item.id);
    return sortItems(found).slice(0, 50);
  },

  async downloadUrl(itemId) {
    if (!INDEX.has(itemId)) throw new ExplorerAccessError('not_found');
    return null;
  },
};
