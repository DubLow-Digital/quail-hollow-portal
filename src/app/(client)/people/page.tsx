import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireClient } from '@/lib/auth/client';
import { listApprovedUsers } from '@/lib/clients/manage-users';
import { PeopleList } from '@/components/people/people-list';
import { AddPersonForm } from '@/components/people/add-person-form';
import { Alert } from '@/components/ui';
import { addPersonAction, invitePersonAction, removePersonAction } from './actions';

export const metadata = { title: 'People' };

/** The main contact sees and manages who else may sign in and send documents for them. */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ removed?: string }>;
}) {
  const ctx = await requireClient();
  const { removed } = await searchParams;
  if (ctx.user.role !== 'primary') redirect('/');
  const people = await listApprovedUsers(ctx.client.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" prefetch={false} className="text-sm font-medium text-brand-700 underline">
          Back to my documents
        </Link>
        <h1 className="mt-3 font-serif text-2xl font-semibold text-brand-900">
          People who can send documents
        </h1>
        <p className="mt-2 text-neutral-700">
          Add anyone who helps with your paperwork, such as an office manager or your spouse. Each
          person signs in with their own email and sees every document we have asked you for.
        </p>
      </div>

      {removed ? <Alert tone="success">Removed. They can no longer sign in.</Alert> : null}

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <PeopleList
          people={people}
          selfId={ctx.user.id}
          actions={{ invite: invitePersonAction, remove: removePersonAction }}
        />
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-lg font-semibold text-brand-900">Add someone</h2>
        <p className="mt-1 mb-4 text-sm text-neutral-600">
          They will get an email with a link to the portal and simple sign-in steps.
        </p>
        <AddPersonForm action={addPersonAction} />
      </section>
    </div>
  );
}
