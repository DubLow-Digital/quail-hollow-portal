import { describe, expect, it } from 'vitest';
import { documentLabel } from '@/lib/requests/document-label';

describe('documentLabel', () => {
  it('adds "(front and back)" when the type asks for both sides', () => {
    expect(documentLabel({ name: "Driver's License", requires_front_back: true })).toBe(
      "Driver's License (front and back)",
    );
  });

  it('never mentions front and back when the setting is off', () => {
    expect(documentLabel({ name: "Driver's License", requires_front_back: false })).toBe(
      "Driver's License",
    );
    expect(documentLabel({ name: 'W-2' })).toBe('W-2');
  });

  it('does not repeat it when the name already says so', () => {
    expect(
      documentLabel({ name: 'Insurance card, Front and Back', requires_front_back: true }),
    ).toBe('Insurance card, Front and Back');
  });

  it('falls back when the type is missing', () => {
    expect(documentLabel(null)).toBe('Document');
    expect(documentLabel(undefined, 'a document')).toBe('a document');
  });
});
