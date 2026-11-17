/**
 * Browser side of passkeys: turns the JSON options from the server into what
 * navigator.credentials expects, and the resulting credential back into JSON. Uses the
 * WebAuthn Level 3 helpers when the browser has them, with a small fallback otherwise.
 */

type Json = Record<string, unknown>;

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

function fromB64url(value: string): ArrayBuffer {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toB64url(buffer: ArrayBuffer | ArrayBufferView | null | undefined): string | undefined {
  if (!buffer) return undefined;
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type PKC = typeof PublicKeyCredential & {
  parseCreationOptionsFromJSON?: (o: Json) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: Json) => PublicKeyCredentialRequestOptions;
};

function creationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const pkc = window.PublicKeyCredential as PKC;
  if (typeof pkc.parseCreationOptionsFromJSON === 'function')
    return pkc.parseCreationOptionsFromJSON(json);
  const user = json.user as Json;
  return {
    ...(json as object),
    challenge: fromB64url(json.challenge as string),
    user: { ...(user as object), id: fromB64url(user.id as string) },
    excludeCredentials: ((json.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({
      ...(c as object),
      id: fromB64url(c.id as string),
    })),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function requestOptions(json: Json): PublicKeyCredentialRequestOptions {
  const pkc = window.PublicKeyCredential as PKC;
  if (typeof pkc.parseRequestOptionsFromJSON === 'function')
    return pkc.parseRequestOptionsFromJSON(json);
  return {
    ...(json as object),
    challenge: fromB64url(json.challenge as string),
    allowCredentials: ((json.allowCredentials as Json[] | undefined) ?? []).map((c) => ({
      ...(c as object),
      id: fromB64url(c.id as string),
    })),
  } as unknown as PublicKeyCredentialRequestOptions;
}

function credentialJson(cred: PublicKeyCredential): Json {
  const withJson = cred as unknown as { toJSON?: () => Json };
  if (typeof withJson.toJSON === 'function') return withJson.toJSON();
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: toB64url(r.clientDataJSON) };
  if ('attestationObject' in r && r.attestationObject) {
    response.attestationObject = toB64url(r.attestationObject);
    if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  } else {
    response.authenticatorData = toB64url(r.authenticatorData);
    response.signature = toB64url(r.signature);
    response.userHandle = toB64url(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response,
  };
}

export async function createPasskeyCredential(options: Json): Promise<Json> {
  const cred = (await navigator.credentials.create({
    publicKey: creationOptions(options),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  return credentialJson(cred);
}

export async function getPasskeyCredential(options: Json): Promise<Json> {
  const cred = (await navigator.credentials.get({
    publicKey: requestOptions(options),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  return credentialJson(cred);
}

/** True when the person closed or declined the passkey prompt. */
export function passkeyCancelled(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return (
    name === 'NotAllowedError' || name === 'AbortError' || (err as Error)?.message === 'cancelled'
  );
}
