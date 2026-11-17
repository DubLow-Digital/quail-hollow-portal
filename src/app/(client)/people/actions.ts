'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getClient } from '@/lib/auth/client';
import { type ActionState, UUID_RE, invalid, str } from '@/lib/actions';
import { audit } from '@/lib/audit';
import { requestMeta } from '@/lib/request-meta';
import {
  MANAGE_ERRORS,
  addApprovedUser,
  getApprovedUser,
  personSchema,
  removeApprovedUser,
} from '@/lib/clients/manage-users';
import { displayName } from '@/lib/clients/users';
import { notifyInvite } from '@/lib/requests/notify';

/**
 * The client's main contact manages who else may sign in for them. Every action re-checks
 * that the person signed in is the main contact and that the target belongs to the same
 * client.
 */

async function mainContact() {
  const ctx = await getClient();
  return ctx && ctx.user.role === 'primary' ? ctx : null;
}

const NOT_ALLOWED: ActionState = {
  ok: false,
  message: 'Only the main contact can change who has access.',
};

async function sameClientPerson(form: FormData, clientId: string) {
  const userId = str(form, 'user_id');
  if (!UUID_RE.test(userId)) return null;
  const user = await getApprovedUser(userId);
  return user && user.client_id === clientId ? user : null;
}

export async function addPersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await mainContact();
  if (!ctx) return NOT_ALLOWED;
  const parsed = personSchema.safeParse({
    first_name: str(form, 'first_name'),
    last_name: str(form, 'last_name'),
    email: str(form, 'email'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await addApprovedUser({
    clientId: ctx.client.id,
    person: parsed.data,
    addedByUser: ctx.user.id,
  });
  if (!result.ok) {
    return result.reason === 'email_taken'
      ? {
          ok: false,
          fieldErrors: {
            email: 'That email already has access. Call our office if you think this is wrong.',
          },
        }
      : { ok: false, message: MANAGE_ERRORS[result.reason] };
  }
  await audit({
    actorType: 'client',
    actorId: ctx.user.id,
    action: 'client_user.added',
    targetType: 'client_user',
    targetId: result.userId,
    metadata: { client: ctx.client.id },
    meta: await requestMeta(),
  });
  let message = `${parsed.data.first_name} can now sign in and send documents for you.`;
  if (str(form, 'send_invite') === '1') {
    const sent = await notifyInvite({ actorType: 'client', actorId: ctx.user.id }, result.userId, {
      invitedBy: displayName(ctx.user),
    });
    message += sent ? ' We emailed them an invite.' : ' The invite could not be sent; try again.';
  }
  revalidatePath('/people');
  return { ok: true, message };
}

export async function invitePersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await mainContact();
  if (!ctx) return NOT_ALLOWED;
  const user = await sameClientPerson(form, ctx.client.id);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  const ok = await notifyInvite({ actorType: 'client', actorId: ctx.user.id }, user.id, {
    invitedBy: user.id === ctx.user.id ? null : displayName(ctx.user),
  });
  if (ok)
    await audit({
      actorType: 'client',
      actorId: ctx.user.id,
      action: 'client_user.invited',
      targetType: 'client_user',
      targetId: user.id,
      meta: await requestMeta(),
    });
  revalidatePath('/people');
  return ok
    ? { ok: true, message: 'Invite sent.' }
    : { ok: false, message: 'The invite could not be sent. Please try again.' };
}

export async function removePersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await mainContact();
  if (!ctx) return NOT_ALLOWED;
  const user = await sameClientPerson(form, ctx.client.id);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  if (user.id === ctx.user.id) return { ok: false, message: 'You cannot remove yourself.' };
  const result = await removeApprovedUser(user.id);
  if (!result.ok) return { ok: false, message: MANAGE_ERRORS[result.reason] };
  await audit({
    actorType: 'client',
    actorId: ctx.user.id,
    action: 'client_user.removed',
    targetType: 'client_user',
    targetId: user.id,
    meta: await requestMeta(),
  });
  // Their row disappears, so confirm on the page itself.
  redirect('/people?removed=1');
}
