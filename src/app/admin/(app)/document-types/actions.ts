'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { invalid, str, strs, UUID_RE, type ActionState } from '@/lib/actions';
import { SUPPORTED_MIME_TYPES } from '@/lib/files/types';
import { NamingTemplateError, validateNamingTemplate } from '@/lib/naming/filename';
import { FolderPathError, validateSubfolderTemplate } from '@/lib/naming/folders';
import { requestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  description: z.string().trim().max(1000),
  slug_for_filename: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,40}$/, 'Letters, digits and hyphens only (max 40).'),
  naming_template: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      try {
        validateNamingTemplate(value);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: err instanceof NamingTemplateError ? err.message : 'Invalid template.',
        });
      }
    }),
  target_subfolder: z
    .string()
    .trim()
    .max(300)
    .superRefine((value, ctx) => {
      try {
        validateSubfolderTemplate(value);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: err instanceof FolderPathError ? err.message : 'Invalid folder.',
        });
      }
    }),
  accepted_mime: z
    .array(z.string().refine((m) => SUPPORTED_MIME_TYPES.includes(m), 'Unsupported type.'))
    .min(1, 'Choose at least one file type.'),
  max_mb: z.coerce.number().int().min(1).max(250),
  requires_year: z.boolean(),
  active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(10000),
});

function read(form: FormData) {
  return schema.safeParse({
    name: str(form, 'name'),
    description: str(form, 'description'),
    slug_for_filename: str(form, 'slug_for_filename'),
    naming_template: str(form, 'naming_template'),
    target_subfolder: str(form, 'target_subfolder').replace(/^\/+|\/+$/g, ''),
    accepted_mime: strs(form, 'accepted_mime'),
    max_mb: str(form, 'max_mb'),
    requires_year: form.get('requires_year') === 'on',
    active: form.get('active') === 'on',
    sort_order: str(form, 'sort_order') || '100',
  });
}

export async function saveDocumentTypeAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = str(form, 'id');
  if (id && !UUID_RE.test(id)) return { ok: false, message: 'Unknown document type.' };
  const parsed = read(form);
  if (!parsed.success) return invalid(parsed.error);
  const db = serviceSupabase();

  const { data: clash } = await db
    .from('document_types')
    .select('id')
    .ilike('name', parsed.data.name.replace(/[%_\\]/g, '\\$&'))
    .maybeSingle();
  if (clash && clash.id !== id)
    return { ok: false, fieldErrors: { name: 'That name is already used.' } };

  let savedId = id;
  if (id) {
    const { error } = await db.from('document_types').update(parsed.data).eq('id', id);
    if (error) return { ok: false, message: 'Could not save. Please try again.' };
  } else {
    const { data, error } = await db
      .from('document_types')
      .insert(parsed.data)
      .select('id')
      .single();
    if (error || !data) return { ok: false, message: 'Could not save. Please try again.' };
    savedId = data.id;
  }

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: id ? 'document_type.updated' : 'document_type.created',
    targetType: 'document_type',
    targetId: savedId,
    meta: await requestMeta(),
  });
  revalidatePath('/admin/document-types');
  if (!id) redirect('/admin/document-types?saved=1');
  return { ok: true, message: 'Saved.' };
}
