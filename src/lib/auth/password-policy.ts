/**
 * Password rules for clients who do not use Google, Microsoft or a passkey. Long rather than
 * complex (NIST SP 800-63B): at least 12 characters, not built from the email address, not a
 * well-known password. A password is always paired with an authenticator app.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  'password1234',
  'password12345',
  'passwordpassword',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  'iloveyou1234',
  'welcome12345',
  'letmein12345',
  'quailhollow1',
  'quailhollow12',
  'quailhollow123',
]);

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating one character.';
  if (COMMON.has(lower)) return 'That password is too common. Try a short phrase instead.';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'Do not use your email address in it.';
  return null;
}
