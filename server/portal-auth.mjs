import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORTAL_API_PORT || 5180);
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const COOKIE_NAME = 'school_portal_session';
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 10;
const BODY_LIMIT = 32 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 12;
const PORTAL_ROLES = new Set(['student', 'parent', 'teacher', 'principal']);
const rateCounts = new Map();

if (!SUPABASE_URL || !SERVICE_KEY || !JWT_SECRET) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_JWT_SECRET in the server environment.',
  );
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cookieOptions(maxAge) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function readCookie(request) {
  const raw = request.headers.cookie || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function allowedOrigin(origin) {
  if (!origin) return true;
  const configured = (process.env.PORTAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const localDev = /^http:\/\/(localhost|127\.0\.0\.1):517[3-9]$/.test(origin);
  return localDev || configured.includes(origin);
}

function rateLimited(request, response) {
  const now = Date.now();
  for (const [key, record] of rateCounts) {
    if (record.expiresAt <= now) rateCounts.delete(key);
  }
  const key = `${request.socket.remoteAddress || 'unknown'}:${request.url}`;
  const record = rateCounts.get(key) || { count: 0, expiresAt: now + RATE_WINDOW_MS };
  record.count += 1;
  rateCounts.set(key, record);
  if (record.count <= RATE_MAX) return false;
  json(response, 429, { error: 'Too many attempts. Wait and try again.' }, {
    'Retry-After': String(Math.ceil((record.expiresAt - now) / 1000)),
  });
  return true;
}

function signJwt(userId, role, schoolId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    aud: 'authenticated',
    role: 'authenticated',
    sub: userId,
    school_role: role,
    school_id: schoolId,
    iat: issuedAt,
    exp: issuedAt + TOKEN_MINUTES * 60,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function hashOpaqueToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function resolveSchool(slug) {
  const { data: bySlug, error } = await db
    .from('schools')
    .select('id,name,slug,status,school_type')
    .eq('status', 'active')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (bySlug) return bySlug;

  const { data: schools, error: schoolsError } = await db
    .from('schools')
    .select('id,name,slug,status,school_type')
    .eq('status', 'active');
  if (schoolsError) throw schoolsError;
  return (schools || []).find((school) =>
    normalizeSlug(school.name) === normalizeSlug(slug),
  ) || null;
}

async function hashPassword(password, salt = randomBytes(16)) {
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('hex'), hash: Buffer.from(result).toString('hex') };
}

async function passwordMatches(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = Buffer.from(await scrypt(password, salt, expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  }));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function newSession(userId, schoolId, role, usernameLogin, response) {
  const opaque = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: sessionCreated, error } = await db.rpc(
    'create_school_portal_login_session',
    {
      p_token_hash: hashOpaqueToken(opaque),
      p_user_id: userId,
      p_school_id: schoolId,
      p_role: role,
      p_expires_at: expiresAt,
      p_username_login: usernameLogin,
    },
  );
  if (error) throw error;
  if (!sessionCreated) return false;
  response.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(opaque)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return true;
}

async function sessionIdentity(request, response) {
  const opaque = readCookie(request);
  if (!opaque) return null;
  const { data, error } = await db
    .from('portal_login_sessions')
    .select('user_id,school_id,requested_role,expires_at')
    .eq('token_hash', hashOpaqueToken(opaque))
    .maybeSingle();
  if (error) throw error;
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
  const [
    { data: school, error: schoolError },
    { data: profile, error: profileError },
    { data: credentials, error: credentialsError },
  ] = await Promise.all([
    db.from('schools').select('id,name,slug,status,school_type').eq('id', data.school_id).maybeSingle(),
    db.from('profiles').select('full_name').eq('id', data.user_id).maybeSingle(),
    db.from('portal_login_credentials')
      .select('username,generated_identifier,status')
      .eq('user_id', data.user_id)
      .maybeSingle(),
  ]);
  if (schoolError) throw schoolError;
  if (profileError) throw profileError;
  if (credentialsError) throw credentialsError;
  if (!school || school.status !== 'active' || credentials?.status !== 'approved') return null;

  const identity = {
    id: data.user_id,
    role: data.requested_role,
    schoolId: data.school_id,
    schoolName: school.name,
    schoolSlug: school.slug,
    schoolType: school.school_type,
    fullName: profile?.full_name || '',
    username: credentials.username,
    loginId: credentials.generated_identifier,
    accessToken: signJwt(data.user_id, data.requested_role, data.school_id),
    welcomeNotification: null,
  };
  return identity;
}

async function handleRequest(request, response) {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) return json(response, 403, { error: 'Origin not allowed.' });
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    return response.end();
  }

  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/auth/')) return json(response, 404, { error: 'Not found.' });
  if (['/api/auth/request', '/api/auth/login'].includes(pathname) && rateLimited(request, response)) return;

  try {
    if (request.method === 'GET' && pathname === '/api/auth/session') {
      const identity = await sessionIdentity(request, response);
      if (!identity) {
        response.setHeader('Set-Cookie', cookieOptions(0));
        return json(response, 200, { identity: null });
      }
      return json(response, 200, { identity });
    }

    if (request.method === 'POST' && pathname === '/api/auth/request') {
      const input = await readJson(request);
      const role = String(input.role || '');
      const username = String(input.username || '').trim().toLowerCase();
      const password = String(input.password || '');
      const fullName = String(input.fullName || '').trim();
      const schoolSlug = normalizeSlug(input.schoolSlug);
      if (!PORTAL_ROLES.has(role)) return json(response, 400, { error: 'Unsupported portal role.' });
      if (!schoolSlug || !username || !fullName || password.length < 8 || password.length > 128) {
        return json(response, 400, { error: 'School, username, full name, and a password of at least 8 characters are required.' });
      }
      if (username.length > 80 || fullName.length > 160 || /[\u0000-\u001f]/.test(username)) {
        return json(response, 400, { error: 'Username or name is invalid.' });
      }
      if (role === 'parent' && (!String(input.phone || '').trim() || !String(input.relatedAdmissionNumber || '').trim())) {
        return json(response, 400, { error: 'Parents must provide a phone number and student admission number.' });
      }

      const school = await resolveSchool(schoolSlug);
      if (!school) return json(response, 404, { error: 'This school link does not match an active registered school.' });
      const credentials = await hashPassword(password);
      const userId = randomUUID();
      const { error: requestError } = await db.rpc(
        'create_school_portal_account_request',
        {
          p_user_id: userId,
          p_school_id: school.id,
          p_role: role,
          p_username: username,
          p_password_salt: credentials.salt,
          p_password_hash: credentials.hash,
          p_full_name: fullName,
          p_email: input.email ? String(input.email).trim().toLowerCase() : null,
          p_phone: input.phone ? String(input.phone).trim() : null,
          p_date_of_birth: input.dateOfBirth || null,
          p_related_admission_number: input.relatedAdmissionNumber || null,
          p_relationship: input.relationship || null,
          p_application_reason: input.applicationReason || null,
        },
      );
      if (requestError) {
        if (requestError.code === '23505') {
          return json(response, 409, { error: 'That username already has an account request at this school.' });
        }
        throw requestError;
      }
      return json(response, 201, { message: 'Your request was submitted for school review.' });
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      const input = await readJson(request);
      const role = String(input.role || '');
      const username = String(input.username || '').trim().toLowerCase();
      const password = String(input.password || '');
      if (!PORTAL_ROLES.has(role) || !username || !password) {
        return json(response, 400, { error: 'Enter your school username or issued ID and password.' });
      }
      const school = await resolveSchool(input.schoolSlug);
      if (!school) return json(response, 401, { error: 'School link or sign-in details are incorrect.' });

      const { data: byUsername, error: usernameError } = await db
        .from('portal_login_credentials')
        .select('user_id,username,password_salt,password_hash,generated_identifier,status,request_id,username_login_used_at')
        .eq('school_id', school.id)
        .eq('requested_role', role)
        .eq('status', 'approved')
        .eq('username', username)
        .is('username_login_used_at', null)
        .maybeSingle();
      if (usernameError) throw usernameError;
      let account = byUsername;
      if (!account) {
        const { data: byIdentifier, error: identifierError } = await db
          .from('portal_login_credentials')
          .select('user_id,username,password_salt,password_hash,generated_identifier,status,request_id,username_login_used_at')
          .eq('school_id', school.id)
          .eq('requested_role', role)
          .eq('status', 'approved')
          .eq('generated_identifier', username.toUpperCase())
          .maybeSingle();
        if (identifierError) throw identifierError;
        account = byIdentifier;
      }
      if (!account && role === 'student') {
        const { data: student, error: studentError } = await db
          .from('students')
          .select('user_id')
          .eq('school_id', school.id)
          .eq('status', 'active')
          .eq('admission_number', username.toUpperCase())
          .maybeSingle();
        if (studentError) throw studentError;

        if (student?.user_id) {
          const { data: byAdmissionNumber, error: admissionCredentialError } =
            await db
              .from('portal_login_credentials')
              .select(
                'user_id,username,password_salt,password_hash,generated_identifier,status,request_id,username_login_used_at',
              )
              .eq('school_id', school.id)
              .eq('requested_role', role)
              .eq('status', 'approved')
              .eq('user_id', student.user_id)
              .maybeSingle();
          if (admissionCredentialError) throw admissionCredentialError;
          account = byAdmissionNumber;
        }
      }
      const matched =
        account &&
        (await passwordMatches(
          password,
          account.password_salt,
          account.password_hash,
        ))
          ? account
          : null;
      if (!matched) {
        return json(response, 401, { error: 'Your request may still be awaiting approval, or the sign-in details are incorrect.' });
      }

      const usernameLogin = matched.username === username;
      const sessionCreated = await newSession(
        matched.user_id,
        school.id,
        role,
        usernameLogin,
        response,
      );
      if (!sessionCreated) {
        return json(response, 401, {
          error: 'Your username has already been used for the first sign-in. Use your issued school ID instead.',
        });
      }
      const { data: profile, error: profileError } = await db
        .from('profiles')
        .select('full_name')
        .eq('id', matched.user_id)
        .single();
      if (profileError) throw profileError;
      const { data: requestRow, error: requestRowError } = await db
        .from('school_account_requests')
        .select('generated_identifier')
        .eq('id', matched.request_id)
        .single();
      if (requestRowError) throw requestRowError;

      const welcomeNotification = requestRow.generated_identifier
        ? `Hey ${profile.full_name}, welcome to ${school.name}! Your school login ID is ${requestRow.generated_identifier}. Next time, sign in with this ID and the password you chose when requesting your account.`
        : null;
      const identity = {
        id: matched.user_id,
        role,
        schoolId: school.id,
        schoolName: school.name,
        schoolSlug: school.slug,
        schoolType: school.school_type,
        fullName: profile.full_name,
        username: matched.username,
        loginId: requestRow.generated_identifier,
        accessToken: signJwt(matched.user_id, role, school.id),
        welcomeNotification,
      };
      return json(response, 200, { identity });
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const opaque = readCookie(request);
      if (opaque) {
        await db.from('portal_login_sessions').delete()
          .eq('token_hash', hashOpaqueToken(opaque));
      }
      response.setHeader('Set-Cookie', cookieOptions(0));
      return json(response, 200, { ok: true });
    }

    return json(response, 404, { error: 'Not found.' });
  } catch (error) {
    const diagnostic =
      error && typeof error === 'object'
        ? {
            code: 'code' in error ? error.code : undefined,
            message: 'message' in error ? error.message : String(error),
          }
        : { message: String(error) };
    const migrationMissing =
      diagnostic.message.includes(
          'portal_login_credentials.username_login_used_at',
      ) ||
      diagnostic.message.includes(
          'create_school_portal_login_session',
      );
    console.error('School portal auth request failed:', {
      path: request.url,
      ...diagnostic,
    });
    const payload = {
      error: migrationMissing
          ? 'The one-time username login database update is missing. Apply migration 202611060007_school_portal_one_time_username.sql, then restart the auth API.'
          : 'The account service could not complete the request. Try again or contact the school administrator.',
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { diagnostic: diagnostic.message }),
    };
    return json(response, 500, payload);
  }
}

createServer((request, response) => {
  void handleRequest(request, response);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`School portal auth API listening on http://127.0.0.1:${PORT}`);
});
