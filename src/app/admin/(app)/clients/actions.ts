'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { invalid, str, strs, UUID_RE, type ActionState } from '@/lib/actions';
import { updateAuthEmail } from '@/lib/clients/auth-user';
import { addApprovedUser, setClientSignInBlocked } from '@/lib/clients/manage-users';
import {
  FolderLinkError,
  createStandardClientFolder,
  resolveFolderUnderRoot,
} from '@/lib/graph/client-folders';
import { GraphError } from '@/lib/graph/client';
import { FolderPathError } from '@/lib/naming/folders';
import { graphEnv } from '@/lib/env';
import { ensureSharePointLocation } from '@/lib/graph/location';
import { requestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import { pushClient } from '@/lib/sync/hub';

const ENTITY_VALUES = ['individual', 'schedule_c', '1120s', '1065', 'other'] as const;

const clientSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required.').max(100),
  last_name: z.string().trim().min(1, 'Last name is required.').max(100),
  email: z
    .email('Enter a valid email address.')
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\-\s]*$/, 'Use digits and + ( ) - only.')
    .transform((v) => v || null),
  entity_types: z.array(z.enum(ENTITY_VALUES)).min(1, 'Choose at least one.'),
});

function readClientForm(form: FormData) {
  return clientSchema.safeParse({
    first_name: str(form, 'first_name'),
    last_name: str(form, 'last_name'),
    email: str(form, 'email'),
    phone: str(form, 'phone'),
    entity_types: strs(form, 'entity_types'),
  });
}

export async function createClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = readClientForm(form);
  if (!parsed.success) return invalid(parsed.error);
  const db = serviceSupabase();

  const { data: dupe } = await db
    .from('clients')
    .select('id')
    .eq('email', parsed.data.email)
    .maybeSingle();
  if (dupe)
    return { ok: false, fieldErrors: { email: 'A client with this email already exists.' } };
  const { data: taken } = await db
    .from('client_users')
    .select('id')
    .eq('email', parsed.data.email)
    .neq('status', 'removed')
    .maybeSingle();
  if (taken)
    return {
      ok: false,
      fieldErrors: { email: 'This email can already sign in for another client.' },
    };

  const { data, error } = await db
    .from('clients')
    .insert({ ...parsed.data, status: 'invited' })
    .select('id')
    .single();
  if (error || !data) {
    log.error('client.insert_failed', { reason: error?.code ?? 'unknown' });
    return { ok: false, message: 'Could not save the client. Please try again.' };
  }
  // The client themselves is the first approved user and the main contact.
  const added = await addApprovedUser({
    clientId: data.id,
    person: {
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      email: parsed.data.email,
    },
    role: 'primary',
    addedByAdmin: admin.aid,
  });
  if (!added.ok) {
    await db.from('clients').delete().eq('id', data.id);
    return { ok: false, message: 'Could not create the sign-in account. Please try again.' };
  }

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.created',
    targetType: 'client',
    targetId: data.id,
    meta: await requestMeta(),
  });
  // Create or link the matching Notion client and Lead Alchemist contact in the background.
  const newId = data.id;
  after(() => pushClient(newId, admin.aid));
  redirect(`/admin/clients/${data.id}?created=1`);
}

export async function updateClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const parsed = readClientForm(form);
  if (!parsed.success) return invalid(parsed.error);
  const db = serviceSupabase();

  const { data: current } = await db
    .from('clients')
    .select('id, email')
    .eq('id', clientId)
    .maybeSingle();
  if (!current) return { ok: false, message: 'Unknown client.' };

  if (parsed.data.email !== current.email) {
    const { data: dupe } = await db
      .from('clients')
      .select('id')
      .eq('email', parsed.data.email)
      .neq('id', clientId)
      .maybeSingle();
    if (dupe)
      return { ok: false, fieldErrors: { email: 'Another client already uses this email.' } };
    // The approved user who signs in with the old email moves to the new one.
    const { data: person } = await db
      .from('client_users')
      .select('id, auth_user_id')
      .eq('client_id', clientId)
      .eq('email', current.email)
      .neq('status', 'removed')
      .maybeSingle();
    if (person) {
      const { data: taken } = await db
        .from('client_users')
        .select('id')
        .eq('email', parsed.data.email)
        .neq('status', 'removed')
        .neq('id', person.id)
        .maybeSingle();
      if (taken)
        return {
          ok: false,
          fieldErrors: { email: 'This email can already sign in to the portal.' },
        };
      try {
        if (person.auth_user_id) await updateAuthEmail(person.auth_user_id, parsed.data.email);
      } catch {
        return { ok: false, message: 'Could not update the sign-in email. Please try again.' };
      }
      await db.from('client_users').update({ email: parsed.data.email }).eq('id', person.id);
    }
  }

  const { error } = await db.from('clients').update(parsed.data).eq('id', clientId);
  if (error) return { ok: false, message: 'Could not save changes. Please try again.' };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.updated',
    targetType: 'client',
    targetId: clientId,
    metadata: { email_changed: parsed.data.email !== current.email },
    meta: await requestMeta(),
  });
  after(() => pushClient(clientId, admin.aid));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: 'Saved.' };
}

export async function setArchivedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  const archive = str(form, 'archive') === '1';
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const db = serviceSupabase();
  const { data: current } = await db
    .from('clients')
    .select('last_login_at')
    .eq('id', clientId)
    .maybeSingle();
  if (!current) return { ok: false, message: 'Unknown client.' };

  try {
    await setClientSignInBlocked(clientId, archive);
  } catch {
    return { ok: false, message: 'Could not update sign-in access. Please try again.' };
  }
  const status = archive ? 'archived' : current.last_login_at ? 'active' : 'invited';
  const { error } = await db.from('clients').update({ status }).eq('id', clientId);
  if (error) return { ok: false, message: 'Could not update the client.' };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: archive ? 'client.archived' : 'client.restored',
    targetType: 'client',
    targetId: clientId,
    meta: await requestMeta(),
  });
  after(() => pushClient(clientId, admin.aid));
  revalidatePath(`/admin/clients/${clientId}`);
  return {
    ok: true,
    message: archive
      ? 'Client archived. Nobody approved for this client can sign in.'
      : 'Client restored.',
  };
}

function folderErrorMessage(err: unknown): string {
  if (err instanceof FolderLinkError || err instanceof FolderPathError) return err.message;
  if (err instanceof GraphError) {
    if (err.status === 403) return 'The portal does not have access to that SharePoint location.';
    if (err.status === 404) return 'That folder could not be found in SharePoint.';
    return 'SharePoint did not respond as expected. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

const DRIVE_ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

export async function linkFolderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  await ensureSharePointLocation();
  const clientId = str(form, 'client_id');
  const folderId = str(form, 'folder_id');
  if (!UUID_RE.test(clientId) || !DRIVE_ITEM_ID.test(folderId)) {
    return { ok: false, message: 'Choose a folder first.' };
  }
  const db = serviceSupabase();

  const { data: taken } = await db
    .from('clients')
    .select('id')
    .eq('sharepoint_folder_id', folderId)
    .neq('id', clientId)
    .maybeSingle();
  if (taken) return { ok: false, message: 'That folder is already linked to another client.' };

  let folder;
  try {
    folder = await resolveFolderUnderRoot(folderId);
  } catch (err) {
    return { ok: false, message: folderErrorMessage(err) };
  }

  const { error } = await db
    .from('clients')
    .update({
      sharepoint_drive_id: graphEnv().SP_DRIVE_ID,
      sharepoint_folder_id: folder.id,
      sharepoint_folder_path: folder.relativePath,
      sharepoint_folder_web_url: folder.webUrl,
    })
    .eq('id', clientId);
  if (error) return { ok: false, message: 'Could not save the folder link.' };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.folder_linked',
    targetType: 'client',
    targetId: clientId,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: `Linked to "${folder.relativePath}".` };
}

export async function createFolderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  await ensureSharePointLocation();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const db = serviceSupabase();
  const { data: client } = await db
    .from('clients')
    .select('first_name, last_name, sharepoint_folder_id')
    .eq('id', clientId)
    .maybeSingle();
  if (!client) return { ok: false, message: 'Unknown client.' };
  if (client.sharepoint_folder_id)
    return { ok: false, message: 'This client already has a folder.' };

  let folder;
  try {
    folder = await createStandardClientFolder(client.first_name, client.last_name);
  } catch (err) {
    return { ok: false, message: folderErrorMessage(err) };
  }

  const { error } = await db
    .from('clients')
    .update({
      sharepoint_drive_id: graphEnv().SP_DRIVE_ID,
      sharepoint_folder_id: folder.id,
      sharepoint_folder_path: folder.relativePath,
      sharepoint_folder_web_url: folder.webUrl,
    })
    .eq('id', clientId);
  if (error)
    return {
      ok: false,
      message: 'The folder was created but could not be linked. Use "Link existing folder".',
    };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.folder_created',
    targetType: 'client',
    targetId: clientId,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: `Created "${folder.relativePath}" with the standard subfolders.` };
}

export async function unlinkFolderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const { error } = await serviceSupabase()
    .from('clients')
    .update({
      sharepoint_drive_id: null,
      sharepoint_folder_id: null,
      sharepoint_folder_path: null,
      sharepoint_folder_web_url: null,
    })
    .eq('id', clientId);
  if (error) return { ok: false, message: 'Could not unlink the folder.' };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.folder_unlinked',
    targetType: 'client',
    targetId: clientId,
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: 'Folder unlinked. Nothing was deleted in SharePoint.' };
}
