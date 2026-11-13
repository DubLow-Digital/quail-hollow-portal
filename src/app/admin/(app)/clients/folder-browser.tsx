'use client';

import { useActionState, useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { ActionMessage } from '@/components/action-forms';
import { SubmitButton } from '@/components/submit-button';
import { Button, Input, cx } from '@/components/ui';

interface FolderNode {
  id: string;
  name: string;
}

type LoadState = { status: 'idle' | 'loading' | 'loaded' | 'error'; children: FolderNode[] };

/**
 * Lazy-loaded SharePoint folder tree for linking an existing client folder. Top-level
 * folders load first; each folder's children load when expanded. The filter box narrows
 * the folders already loaded by name.
 */
export function FolderBrowser({
  clientId,
  action,
}: {
  clientId: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [tree, setTree] = useState<Record<string, LoadState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<FolderNode | null>(null);
  const [filter, setFilter] = useState('');
  const [state, formAction] = useActionState(action, { ok: false });

  const load = useCallback(async (parent: string) => {
    setTree((t) => ({
      ...t,
      [parent]: { status: 'loading', children: t[parent]?.children ?? [] },
    }));
    try {
      const qs = parent === 'root' ? '' : `?parent=${encodeURIComponent(parent)}`;
      const res = await fetch(`/api/admin/folders${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { folders: FolderNode[] };
      setTree((t) => ({ ...t, [parent]: { status: 'loaded', children: body.folders } }));
    } catch {
      setTree((t) => ({ ...t, [parent]: { status: 'error', children: [] } }));
    }
  }, []);

  useEffect(() => {
    // Initial load of the top-level client folders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load('root');
  }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (!tree[id]) void load(id);
      }
      return next;
    });
  };

  const needle = filter.trim().toLowerCase();
  const rootState = tree.root;
  const visibleRoot = useMemo(
    () =>
      (rootState?.children ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle)),
    [rootState, needle],
  );

  const renderNodes = (nodes: FolderNode[], depth: number) => (
    <ul className={cx(depth > 0 && 'ml-5 border-l border-neutral-200 pl-2')}>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.id);
        const child = tree[node.id];
        return (
          <li key={node.id}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
                className="flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
              >
                <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelected(node)}
                aria-pressed={selected?.id === node.id}
                className={cx(
                  'flex-1 rounded-lg px-2 py-2 text-left text-sm',
                  selected?.id === node.id
                    ? 'bg-brand-100 font-medium text-brand-900'
                    : 'hover:bg-neutral-100',
                )}
              >
                <span aria-hidden="true">📁 </span>
                {node.name}
              </button>
            </div>
            {isOpen ? (
              child?.status === 'loaded' ? (
                child.children.length ? (
                  renderNodes(child.children, depth + 1)
                ) : (
                  <p className="ml-12 py-1 text-xs text-neutral-500">No subfolders</p>
                )
              ) : child?.status === 'error' ? (
                <p className="ml-12 py-1 text-xs text-red-700">Could not load subfolders.</p>
              ) : (
                <p className="ml-12 py-1 text-xs text-neutral-500">Loading…</p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Filter folders by name"
        aria-label="Filter folders by name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="max-h-80 overflow-y-auto rounded-xl bg-neutral-50 p-2 ring-1 ring-neutral-200">
        {rootState?.status === 'error' ? (
          <div className="space-y-2 p-2 text-sm text-red-700">
            <p>Could not load SharePoint folders.</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load('root')}>
              Try again
            </Button>
          </div>
        ) : rootState?.status !== 'loaded' ? (
          <p className="p-2 text-sm text-neutral-500">Loading folders…</p>
        ) : visibleRoot.length === 0 ? (
          <p className="p-2 text-sm text-neutral-500">No matching folders.</p>
        ) : (
          renderNodes(visibleRoot, 0)
        )}
      </div>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="folder_id" value={selected?.id ?? ''} />
        <p className="text-sm text-neutral-700">
          Selected: <span className="font-medium">{selected?.name ?? 'none'}</span>
        </p>
        <SubmitButton size="sm" disabled={!selected} pendingLabel="Linking…">
          Link this folder
        </SubmitButton>
        <ActionMessage state={state} />
      </form>
    </div>
  );
}
