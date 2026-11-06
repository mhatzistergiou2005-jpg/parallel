const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const pbkdf2 = promisify(crypto.pbkdf2);
const COOKIE_NAME = 'parallel_session';
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_BYTES = 32;
const PASSWORD_HASH_LENGTH = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ANSWER_VALUES = new Set([
  'creative', 'analysis', 'communication', 'organization', 'research', 'business',
  'technology', 'health', 'education', 'finance', 'law', 'science', 'sustainability',
  'helping', 'public', 'entrepreneurship', 'leadership', 'engineering', 'media',
  'hospitality', 'architecture'
]);
const CAREER_NAMES = new Set([
  'Digital Marketing', 'Social Media Management', 'Brand Management', 'Market Research',
  'Public Relations', 'Event Management', 'Business Development', 'Human Resources',
  'UX/UI Design', 'Advertising & Creative Strategy', 'Software & Web Development',
  'Data & Business Analytics', 'Education & Training', 'Healthcare & Wellbeing',
  'Finance & Accounting', 'Law & Policy', 'Science & Research', 'Engineering & Product',
  'Sustainability & Environment', 'Media & Journalism', 'Hospitality & Tourism',
  'Entrepreneurship & Startups', 'Public Service & Nonprofit',
  'Architecture & Spatial Design', 'People Leadership & Operations'
]);
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/overrides.css': ['overrides.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8'],
  '/career-engine.js': ['career-engine.js', 'text/javascript; charset=utf-8']
};
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(path.dirname(databasePath), 0o700);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      answers TEXT NOT NULL DEFAULT '{}',
      selected_career TEXT NOT NULL DEFAULT '',
      completed TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  try {
    fs.chmodSync(databasePath, 0o600);
    fs.chmodSync(`${databasePath}-wal`, 0o600);
    fs.chmodSync(`${databasePath}-shm`, 0o600);
  } catch (error) {
    if (process.platform !== 'win32' && error.code !== 'ENOENT') throw error;
  }
  return db;
}

function jsonResponse(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function cookieValue(request) {
  const cookies = request.headers.cookie || '';
  for (const item of cookies.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === COOKIE_NAME) return item.slice(separator + 1).trim();
  }
  return null;
}

function secureCookie(request) {
  return process.env.NODE_ENV === 'production' || request.socket.encrypted ||
    request.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(token, request) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME / 1000}${secure}`;
}

function expiredCookie(request) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function cleanUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

function readProfile(db, userId) {
  const row = db.prepare('SELECT answers, selected_career, completed FROM profiles WHERE user_id = ?').get(userId);
  return {
    answers: JSON.parse(row.answers),
    selectedCareer: row.selected_career,
    completed: JSON.parse(row.completed)
  };
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const answers = input.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const answerEntries = Object.entries(answers);
  if (answerEntries.length > 10 || answerEntries.some(([index, values]) =>
    !/^(?:[0-9])$/.test(index) || !Array.isArray(values) || values.length > 6 ||
    values.some(value => typeof value !== 'string' || !ANSWER_VALUES.has(value))
  )) return null;

  const selectedCareer = input.selectedCareer ?? '';
  if (typeof selectedCareer !== 'string' || (selectedCareer !== '' && !CAREER_NAMES.has(selectedCareer))) return null;

  const completed = input.completed ?? {};
  if (!completed || typeof completed !== 'object' || Array.isArray(completed)) return null;
  const completedEntries = Object.entries(completed);
  if (completedEntries.length > 9 || completedEntries.some(([key, value]) =>
    !/^[0-2]-[0-2]$/.test(key) || typeof value !== 'boolean'
  )) return null;

  return { answers, selectedCareer, completed };
}

function createApp(options = {}) {
  const databasePath = options.databasePath || path.join(process.cwd(), 'data', 'career.db');
  const db = createDatabase(databasePath);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const authRate = new Map();
  const dummySalt = crypto.randomBytes(16);
  const dummyHash = crypto.randomBytes(PASSWORD_HASH_LENGTH);

  function getAuthenticatedUser(request) {
    const token = cookieValue(request);
    if (!token || !/^[\w-]{40,60}$/.test(token)) return null;
    const session = db.prepare(`
      SELECT users.id, users.name, users.email
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), Date.now());
    return session || null;
  }

  function applySession(request, userId, response) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, Date.now() + SESSION_LIFETIME);
    response.setHeader('Set-Cookie', sessionCookie(token, request));
  }

  function rateLimited(request, response) {
    const key = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (authRate.get(key) || []).filter(timestamp => timestamp > now - 15 * 60 * 1000);
    if (recent.length >= 20) {
      jsonResponse(response, 429, { error: 'Too many account attempts. Please try again later.' }, { 'Retry-After': '900' });
      return true;
    }
    recent.push(now);
    authRate.set(key, recent);
    return false;
  }

  async function handleApi(request, response, pathname) {
    if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        jsonResponse(response, 403, { error: 'Request origin was not accepted.' });
        return;
      }
    }

    if (pathname === '/api/register' && request.method === 'POST') {
      if (rateLimited(request, response)) return;
      const input = await readJson(request);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (name.length < 1 || name.length > 80 || !EMAIL_PATTERN.test(email) || email.length > 254 ||
          password.length < 10 || password.length > 128) {
        jsonResponse(response, 400, { error: 'Enter a name, valid email, and password with at least 10 characters.' });
        return;
      }
      const salt = crypto.randomBytes(16);
      const passwordHash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_BYTES, 'sha256');
      const id = crypto.randomUUID();
      try {
        db.prepare('INSERT INTO users (id, name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, name, email, salt.toString('hex'), passwordHash.toString('hex'), Date.now());
      } catch (error) {
        if (error.errcode === 2067) {
          jsonResponse(response, 409, { error: 'An account already exists for this email.' });
          return;
        }
        throw error;
      }
      db.prepare('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)').run(id, Date.now());
      applySession(request, id, response);
      jsonResponse(response, 201, { user: { id, name, email }, profile: readProfile(db, id) });
      return;
    }

    if (pathname === '/api/login' && request.method === 'POST') {
      if (rateLimited(request, response)) return;
      const input = await readJson(request);
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      const user = db.prepare('SELECT id, name, email, password_salt, password_hash FROM users WHERE email = ?').get(email);
      const salt = user ? Buffer.from(user.password_salt, 'hex') : dummySalt;
      const expected = user ? Buffer.from(user.password_hash, 'hex') : dummyHash;
      const actual = await pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_HASH_LENGTH, 'sha256');
      if (!user || !crypto.timingSafeEqual(actual, expected)) {
        jsonResponse(response, 401, { error: 'Email or password is incorrect.' });
        return;
      }
      applySession(request, user.id, response);
      jsonResponse(response, 200, { user: cleanUser(user), profile: readProfile(db, user.id) });
      return;
    }

    if (pathname === '/api/logout' && request.method === 'POST') {
      const token = cookieValue(request);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      jsonResponse(response, 200, { ok: true }, { 'Set-Cookie': expiredCookie(request) });
      return;
    }

    if (pathname === '/api/me' && request.method === 'GET') {
      const user = getAuthenticatedUser(request);
      if (!user) {
        jsonResponse(response, 401, { error: 'Please log in to continue.' });
        return;
      }
      jsonResponse(response, 200, { user: cleanUser(user), profile: readProfile(db, user.id) });
      return;
    }

    if (pathname === '/api/profile' && request.method === 'PUT') {
      const user = getAuthenticatedUser(request);
      if (!user) {
        jsonResponse(response, 401, { error: 'Please log in to continue.' });
        return;
      }
      const profile = validateProfile(await readJson(request));
      if (!profile) {
        jsonResponse(response, 400, { error: 'The profile data was invalid.' });
        return;
      }
      db.prepare(`
        UPDATE profiles
        SET answers = ?, selected_career = ?, completed = ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(profile.answers), profile.selectedCareer, JSON.stringify(profile.completed), Date.now(), user.id);
      jsonResponse(response, 200, { profile });
      return;
    }

    jsonResponse(response, 404, { error: 'API route not found.' });
  }

  const server = http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      jsonResponse(response, 400, { error: 'Invalid request path.' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      handleApi(request, response, pathname).catch(error => {
        if (response.headersSent) {
          response.destroy(error);
          return;
        }
        if (error.status) {
          jsonResponse(response, error.status, { error: error.message });
          return;
        }
        console.error('Request failed:', error);
        jsonResponse(response, 500, { error: 'The request could not be completed.' });
      });
      return;
    }

    const file = STATIC_FILES[pathname];
    if (request.method !== 'GET' || !file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('Not found.');
      return;
    }
    const filePath = path.join(__dirname, file[0]);
    response.writeHead(200, {
      'Content-Type': file[1],
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY
    });
    fs.createReadStream(filePath).pipe(response);
  });

  return {
    server,
    close() {
      db.close();
    }
  };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`PARALLEL is running at http://${host}:${port}`);
  });
}

module.exports = { createApp };
