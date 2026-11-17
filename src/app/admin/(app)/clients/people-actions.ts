'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/admin';
import { type ActionState, UUID_RE, invalid, str } from '@/lib/actions';
import { audit } from '@/lib/audit';
import { requestMeta } from '@/lib/request-meta';
import {
  MANAGE_ERRORS,
  addApprovedUser,
  getApprovedUser,
  makePrimary,
  personSchema,
  removeApprovedUser,
  resetApprovedUserSignIn,
} from '@/lib/clients/manage-users';
import { notifyInvite } from '@/lib/requests/notify';

/** Aleida (or Todd) manages who may sign in for a client. */

async function forUser(form: FormData) {
  const admin = await requireAdmin();
  const userId = str(form, 'user_id');
  const user = UUID_RE.test(userId) ? await getApprovedUser(userId) : null;
  return { admin, user };
}

export async function addPersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const parsed = personSchema.safeParse({
    first_name: str(form, 'first_name'),
    last_name: str(form, 'last_name'),
    email: str(form, 'email'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await addApprovedUser({ clientId, person: parsed.data, addedByAdmin: admin.aid });
  if (!result.ok) {
    return result.reason === 'email_taken'
      ? { ok: false, fieldErrors: { email: MANAGE_ERRORS.email_taken } }
      : { ok: false, message: MANAGE_ERRORS[result.reason] };
  }
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client_user.added',
    targetType: 'client_user',
    targetId: result.userId,
    metadata: { client: clientId },
    meta: await requestMeta(),
  });
  let message = `${parsed.data.first_name} can now sign in for this client.`;
  if (str(form, 'send_invite') === '1') {
    const sent = await notifyInvite({ actorType: 'admin', actorId: admin.aid }, result.userId);
    message += sent ? ' Invite sent.' : ' The invite could not be sent; try Send invite.';
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message };
}

export async function invitePersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { admin, user } = await forUser(form);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  const ok = await notifyInvite({ actorType: 'admin', actorId: admin.aid }, user.id);
  if (ok)
    await audit({
      actorType: 'admin',
      actorId: admin.aid,
      action: 'client_user.invited',
      targetType: 'client_user',
      targetId: user.id,
      meta: await requestMeta(),
    });
  revalidatePath(`/admin/clients/${user.client_id}`);
  return ok
    ? { ok: true, message: 'Invite sent.' }
    : { ok: false, message: 'The invite could not be sent.' };
}

export async function removePersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { admin, user } = await forUser(form);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  const result = await removeApprovedUser(user.id);
  if (!result.ok) return { ok: false, message: MANAGE_ERRORS[result.reason] };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client_user.removed',
    targetType: 'client_user',
    targetId: user.id,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${user.client_id}`);
  return { ok: true, message: 'Removed. They can no longer sign in.' };
}

export async function resetPersonAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { admin, user } = await forUser(form);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  const result = await resetApprovedUserSignIn(user.id);
  if (!result.ok) return { ok: false, message: MANAGE_ERRORS[result.reason] };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client_user.sign_in_reset',
    targetType: 'client_user',
    targetId: user.id,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${user.client_id}`);
  return {
    ok: true,
    message: 'Sign-in reset. They are signed out everywhere and set up again with an emailed code.',
  };
}

export async function makePrimaryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { admin, user } = await forUser(form);
  if (!user) return { ok: false, message: MANAGE_ERRORS.not_found };
  const result = await makePrimary(user.id);
  if (!result.ok) return { ok: false, message: MANAGE_ERRORS[result.reason] };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client_user.made_primary',
    targetType: 'client_user',
    targetId: user.id,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${user.client_id}`);
  return { ok: true, message: 'Main contact updated.' };
}
