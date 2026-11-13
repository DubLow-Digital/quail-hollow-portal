'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { invalid, str, strs, UUID_RE, type ActionState } from '@/lib/actions';
import { requestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  description: z.string().trim().max(500),
  document_type_ids: z
    .array(z.string().regex(UUID_RE))
    .min(1, 'Choose at least one document type.'),
});

export async function saveBundleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = str(form, 'id');
  if (id && !UUID_RE.test(id)) return { ok: false, message: 'Unknown bundle.' };
  const parsed = schema.safeParse({
    name: str(form, 'name'),
    description: str(form, 'description'),
    document_type_ids: [...new Set(strs(form, 'document_type_ids'))],
  });
  if (!parsed.success) return invalid(parsed.error);
  const db = serviceSupabase();

  const { data: types } = await db
    .from('document_types')
    .select('id, sort_order')
    .in('id', parsed.data.document_type_ids);
  if (!types || types.length !== parsed.data.document_type_ids.length) {
    return { ok: false, message: 'One of the document types no longer exists.' };
  }

  let bundleId = id;
  if (id) {
    const { error } = await db
      .from('request_bundles')
      .update({ name: parsed.data.name, description: parsed.data.description })
      .eq('id', id);
    if (error)
      return {
        ok: false,
        message: error.code === '23505' ? 'That name is already used.' : 'Could not save.',
      };
    await db.from('request_bundle_items').delete().eq('bundle_id', id);
  } else {
    const { data, error } = await db
      .from('request_bundles')
      .insert({ name: parsed.data.name, description: parsed.data.description })
      .select('id')
      .single();
    if (error || !data) {
      return {
        ok: false,
        message: error?.code === '23505' ? 'That name is already used.' : 'Could not save.',
      };
    }
    bundleId = data.id;
  }

  const { error: itemsError } = await db
    .from('request_bundle_items')
    .insert(
      types.map((t) => ({ bundle_id: bundleId, document_type_id: t.id, sort_order: t.sort_order })),
    );
  if (itemsError)
    return { ok: false, message: 'Saved the bundle but not its document types. Please try again.' };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: id ? 'bundle.updated' : 'bundle.created',
    targetType: 'bundle',
    targetId: bundleId,
    metadata: { item_count: types.length },
    meta: await requestMeta(),
  });
  revalidatePath('/admin/bundles');
  return { ok: true, message: 'Bundle saved.' };
}

export async function deleteBundleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = str(form, 'id');
  if (!UUID_RE.test(id)) return { ok: false, message: 'Unknown bundle.' };
  const { error } = await serviceSupabase().from('request_bundles').delete().eq('id', id);
  if (error) return { ok: false, message: 'Could not delete the bundle.' };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'bundle.deleted',
    targetType: 'bundle',
    targetId: id,
    meta: await requestMeta(),
  });
  revalidatePath('/admin/bundles');
  return { ok: true, message: 'Bundle deleted.' };
}
