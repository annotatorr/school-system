import { setSupabasePortalAccessToken } from './supabase';

export type SchoolPortalRole = 'student' | 'parent' | 'teacher' | 'principal';

export type PortalIdentity = {
  id: string;
  role: SchoolPortalRole;
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  schoolType?: string | null;
  fullName: string;
  username: string;
  loginId: string | null;
  accessToken: string;
  welcomeNotification: string | null;
};

let currentIdentity: PortalIdentity | null = null;

function isIdentity(value: unknown): value is PortalIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<PortalIdentity>;
  return Boolean(
    identity.id &&
      identity.role &&
      identity.schoolId &&
      identity.schoolName &&
      identity.fullName &&
      identity.accessToken,
  );
}

function applyIdentity(identity: PortalIdentity | null): void {
  currentIdentity = identity;
  setSupabasePortalAccessToken(identity?.accessToken ?? null);
}

async function authRequest<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      'The school sign-in service is unreachable. Start it with "npm run dev:portal-auth" and check its server configuration.',
    );
  }

  const responseText = await response.text();
  let result: {
    identity?: unknown;
    accessToken?: string;
    error?: string;
    diagnostic?: string;
  };
  try {
    result = responseText
      ? (JSON.parse(responseText) as typeof result)
      : {};
  } catch {
    throw new Error(
      `The school sign-in service returned an invalid response (${response.status}). Check that the auth API is running and configured.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      [result.error, result.diagnostic].filter(Boolean).join(' — ') ||
        `The school sign-in service returned an error (${response.status}). Check the auth API terminal for details.`,
    );
  }
  if (!responseText) {
    throw new Error(
      'The school sign-in service returned an empty response. Check that the auth API is running and configured.',
    );
  }
  return result as T;
}

export async function restorePortalIdentity(): Promise<PortalIdentity | null> {
  const result = await authRequest<{ identity?: unknown }>('session');
  if (!isIdentity(result.identity)) {
    applyIdentity(null);
    return null;
  }
  applyIdentity(result.identity);
  return currentIdentity;
}

export async function loginSchoolPortal(input: {
  schoolSlug: string;
  role: SchoolPortalRole;
  username: string;
  password: string;
}): Promise<PortalIdentity> {
  const result = await authRequest<{ identity?: unknown }>('login', input);
  if (!isIdentity(result.identity)) {
    throw new Error('The server returned an invalid account session.');
  }
  applyIdentity(result.identity);
  return result.identity;
}

export async function requestSchoolPortalAccount(input: {
  schoolSlug: string;
  role: SchoolPortalRole;
  username: string;
  password: string;
  fullName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  relatedAdmissionNumber?: string;
  relationship?: string;
  applicationReason?: string;
}): Promise<void> {
  await authRequest('request', input);
}

export async function logoutSchoolPortal(): Promise<void> {
  try {
    await authRequest('logout', {});
  } finally {
    applyIdentity(null);
  }
}

export function getCurrentPortalIdentity(): PortalIdentity | null {
  return currentIdentity;
}

export function setPortalIdentity(identity: PortalIdentity): void {
  applyIdentity(identity);
}
