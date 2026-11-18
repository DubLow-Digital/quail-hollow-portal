/**
 * The name shown for a document type. When the type asks for both sides of a card,
 * "(front and back)" is added, unless the name already says so. When it does not, front and
 * back are never mentioned.
 */
export function documentLabel(
  type: { name: string; requires_front_back?: boolean | null } | null | undefined,
  fallback = 'Document',
): string {
  if (!type) return fallback;
  if (!type.requires_front_back || /front\s+and\s+back/i.test(type.name)) return type.name;
  return `${type.name} (front and back)`;
}
