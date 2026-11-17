import type { ActionState } from '@/lib/actions';
import { ActionButtonForm } from '@/components/action-forms';
import { Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/status';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface PersonRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'primary' | 'member';
  status: 'invited' | 'active' | 'removed';
  invited_at: string | null;
  last_login_at: string | null;
  last_login_method: string | null;
}

const METHOD: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  passkey: 'passkey',
  password: 'password and authenticator app',
};

/**
 * The people approved to sign in for a client, with the actions the viewer may take.
 * Admins see every action; a client's main contact can invite and remove others.
 */
export function PeopleList({
  people,
  selfId,
  actions,
}: {
  people: PersonRow[];
  selfId?: string | null;
  actions: { invite: Action; remove: Action; reset?: Action; makePrimary?: Action };
}) {
  return (
    <ul className="divide-y divide-neutral-100">
      {people.map((p) => {
        const name = `${p.first_name} ${p.last_name}`.trim() || p.email;
        const self = p.id === selfId;
        return (
          <li key={p.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-neutral-900">{name}</span>
              {self ? <Badge tone="neutral">You</Badge> : null}
              {p.role === 'primary' ? <Badge tone="blue">Main contact</Badge> : null}
              <Badge tone={p.status === 'active' ? 'green' : 'amber'}>
                {p.status === 'active' ? 'Active' : 'Invited'}
              </Badge>
            </div>
            <p className="text-sm text-neutral-600">
              {p.email}
              {p.last_login_at
                ? ` · Last sign-in ${formatDateTime(p.last_login_at)}${p.last_login_method ? ` with ${METHOD[p.last_login_method] ?? p.last_login_method}` : ''}`
                : p.invited_at
                  ? ` · Invited ${formatDateTime(p.invited_at)}`
                  : ' · Not invited yet'}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButtonForm
                action={actions.invite}
                hidden={{ user_id: p.id }}
                label={p.invited_at ? 'Resend invite' : 'Send invite'}
                pendingLabel="Sending…"
                variant="ghost"
              />
              {actions.makePrimary && p.role !== 'primary' ? (
                <ActionButtonForm
                  action={actions.makePrimary}
                  hidden={{ user_id: p.id }}
                  label="Make main contact"
                  variant="ghost"
                />
              ) : null}
              {actions.reset ? (
                <ActionButtonForm
                  action={actions.reset}
                  hidden={{ user_id: p.id }}
                  label="Reset sign-in"
                  variant="ghost"
                  confirm={`Reset ${name}'s sign-in? Their password, passkeys and authenticator apps are removed and they sign out everywhere. They set up again with an emailed code.`}
                />
              ) : null}
              {p.role !== 'primary' && !self ? (
                <ActionButtonForm
                  action={actions.remove}
                  hidden={{ user_id: p.id }}
                  label="Remove"
                  variant="danger"
                  confirm={`Remove ${name}? They will no longer be able to sign in.`}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
