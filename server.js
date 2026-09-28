// Kingdom Glory Church — API (Express 5) for Vercel + Supabase
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const SECRET = process.env.JWT_SECRET || '';
const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'member-photos';
const COOKIE = 'kgc_access';
const SESSION_MS = 2 * 60 * 60 * 1000;

if (SECRET.length < 32) console.warn('WARNING: JWT_SECRET must be set to a random value of at least 32 characters.');
if (!process.env.DATABASE_URL) console.warn('WARNING: DATABASE_URL is not set — database calls will fail.');

/* ---------- Database (Supabase Postgres via the pooler) ---------- */
const dbUrl = process.env.DATABASE_URL || '';
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false },
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000
});
pool.on('error', e => console.error('Postgres pool error:', e.message));
const q = (text, params) => pool.query(text, params);

/* ---------- Supabase Storage (private profile photos; Vercel disk is read-only) ---------- */
let sb;
function storage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase storage is not configured');
  sb ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return sb.storage;
}
let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await storage().createBucket(BUCKET, { public: false, fileSizeLimit: 4 * 1024 * 1024 });
  if (error && !/exist/i.test(error.message)) throw error;
  bucketReady = true;
}
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return ['image/jpeg', 'jpg'];
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
async function savePhoto(file) {
  const kind = sniffImage(file.buffer);
  if (!kind) throw new Error('Unsupported photo type');
  await ensureBucket();
  const key = `${crypto.randomUUID()}.${kind[1]}`;
  const { error } = await storage().from(BUCKET).upload(key, file.buffer, { contentType: kind[0], upsert: false });
  if (error) throw error;
  return { key, mime: kind[0], size: file.size };
}
async function sendPhoto(res, key, mime) {
  if (!key) return res.status(404).end();
  try {
    const { data, error } = await storage().from(BUCKET).download(key);
    if (error || !data) return res.status(404).end();
    res.set({ 'Content-Type': mime || 'image/jpeg', 'Cache-Control': 'private, max-age=300' });
    res.send(Buffer.from(await data.arrayBuffer()));
  } catch (e) { console.error('Photo fetch failed:', e.message); res.status(404).end(); }
}

/* ---------- App setup ---------- */
const app = express();
app.set('trust proxy', 1); // Vercel sits in front of us
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(compression());
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // local dev; on Vercel /public is served by the CDN

const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Please wait a while and try again.' } });
const authLimiter = limiter(15 * 60 * 1000, 30);
const registrationLimiter = limiter(60 * 60 * 1000, 10);
const contactLimiter = limiter(60 * 60 * 1000, 8);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

/* ---------- Helpers ---------- */
const emptyToUndef = s => z.preprocess(v => (v === '' || v === null ? undefined : v), s.optional());
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };
const ipOf = req => (net.isIP(req.ip || '') ? req.ip : null);
const firstIssue = err => err.issues?.[0] ? `${err.issues[0].path.join('.') || 'Form'}: ${err.issues[0].message}` : 'Invalid data';

async function audit(client, actor, action, targetType, targetId, metadata, req) {
  await client.query(
    'INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
    [actor || null, action, targetType || null, targetId || null, metadata || {}, ipOf(req)]
  );
}

async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  let payload;
  try { payload = jwt.verify(token, SECRET); }
  catch { return res.status(401).json({ message: 'Your session has expired. Please sign in again.' }); }
  const { rows } = await q('SELECT id, role, status FROM users WHERE id=$1', [payload.sub]);
  const u = rows[0];
  if (!u || u.status !== 'ACTIVE') {
    res.clearCookie(COOKIE, cookieOpts);
    return res.status(401).json({ message: 'This account is not active.' });
  }
  req.user = { sub: u.id, role: u.role };
  next();
}
const roleGate = roles => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission to do this.' });
const requireAdmin = roleGate(['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN']);
const requireChurchAdmin = roleGate(['SUPER_ADMIN', 'CHURCH_ADMIN']);
const requireFinanceAdmin = roleGate(['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN', 'FINANCE_OFFICER']);

// For branch admins, returns their branch id (they may only see their own branch). Others: null = all branches.
async function branchScope(req, res) {
  if (req.user.role !== 'BRANCH_ADMIN') return null;
  const { rows } = await q('SELECT branch_id FROM members WHERE user_id=$1', [req.user.sub]);
  if (!rows[0]?.branch_id) { res.status(403).json({ message: 'Your admin account has no branch assigned.' }); return undefined; }
  return rows[0].branch_id;
}

/* ---------- Public ---------- */
app.get('/api/health', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (e) { console.error('Health check failed:', e.message); res.status(503).json({ ok: false, database: 'unreachable' }); }
});

app.get('/api/branches', async (_req, res) => {
  const { rows } = await q('SELECT id, name, location, service_times FROM branches WHERE active = TRUE ORDER BY name');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60').json(rows);
});

app.get('/api/events', async (_req, res) => {
  const { rows } = await q(`SELECT id, title, description, starts_at, location FROM events
    WHERE published = TRUE AND starts_at >= NOW() - INTERVAL '3 hours' ORDER BY starts_at LIMIT 9`);
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60').json(rows);
});

app.get('/api/sermons', async (_req, res) => {
  const { rows } = await q(`SELECT id, title, speaker, preached_on, video_url, thumbnail_url FROM sermons
    WHERE published = TRUE ORDER BY preached_on DESC, created_at DESC LIMIT 7`);
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60').json(rows);
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  const p = z.object({
    name: z.string().trim().min(2).max(160),
    email: emptyToUndef(z.string().trim().email().max(320)),
    phone: emptyToUndef(z.string().trim().max(40)),
    topic: z.enum(['General', 'Prayer request', 'Plan a visit', 'Feedback']).default('General'),
    body: z.string().trim().min(5).max(3000)
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data;
  if (!d.email && !d.phone) return res.status(400).json({ message: 'Please add an email or phone number so we can reply.' });
  await q('INSERT INTO messages(name,email,phone,topic,body) VALUES($1,$2,$3,$4,$5)', [d.name, d.email || null, d.phone || null, d.topic, d.body]);
  res.status(201).json({ message: 'Message received. Our team will get back to you soon.' });
});

/* ---------- Auth ---------- */
const registrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(160),
  dateOfBirth: emptyToUndef(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')),
  gender: emptyToUndef(z.string().trim().max(30)),
  phone: z.string().trim().min(7, 'Enter a valid phone number').max(40),
  email: z.string().trim().email('Enter a valid email address').max(320),
  address: emptyToUndef(z.string().trim().max(1000)),
  branchId: emptyToUndef(z.string().uuid()),
  ministry: emptyToUndef(z.string().trim().max(120)),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  terms: z.enum(['true', 'on', '1'], 'Please accept the privacy terms')
});

app.post('/api/auth/register', registrationLimiter, upload.single('profilePhoto'), async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
  const data = parsed.data;

  let photo = null;
  if (req.file) {
    try { photo = await savePhoto(req.file); }
    catch (e) { console.error('Photo upload skipped:', e.message); } // registration still succeeds without a photo
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dup = await client.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [data.email]);
    if (dup.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'An account with this email already exists.' }); }
    const hash = await bcrypt.hash(data.password, 12);
    const u = (await client.query(`INSERT INTO users(email,password_hash,status) VALUES($1,$2,'PENDING') RETURNING id`, [data.email, hash])).rows[0];
    await client.query(
      `INSERT INTO members(user_id,branch_id,full_name,date_of_birth,gender,phone,address,ministry,profile_photo_key,profile_photo_mime,profile_photo_size)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [u.id, data.branchId || null, data.fullName, data.dateOfBirth || null, data.gender || null, data.phone, data.address || null,
       data.ministry || null, photo?.key || null, photo?.mime || null, photo?.size || null]);
    await audit(client, u.id, 'MEMBER_REGISTRATION_SUBMITTED', 'user', u.id, { status: 'PENDING' }, req);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Registration received. An administrator will review and activate your account.', status: 'PENDING', photoSaved: !!photo });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23503') return res.status(400).json({ message: 'Please choose a valid branch.' });
    if (e.code === '22007' || e.code === '22008') return res.status(400).json({ message: 'Please enter a valid date of birth.' });
    throw e;
  } finally { client.release(); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const p = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: 'Enter your email and password.' });
  if (SECRET.length < 32) { console.error('JWT_SECRET missing/too short'); return res.status(500).json({ message: 'Server is not configured yet.' }); }
  const { rows } = await q('SELECT id,email,password_hash,role,status FROM users WHERE LOWER(email)=LOWER($1)', [p.data.email]);
  const user = rows[0];
  const ok = user ? await bcrypt.compare(p.data.password, user.password_hash) : await bcrypt.compare(p.data.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) return res.status(401).json({ message: 'Incorrect email or password.' });
  if (user.status !== 'ACTIVE') {
    const msg = { PENDING: 'Your registration is still waiting for administrator approval.', REJECTED: 'This registration was not approved. Please contact the church office.', SUSPENDED: 'This account is suspended. Please contact the church office.' }[user.status] || 'This account is not active.';
    return res.status(403).json({ message: msg });
  }
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '2h' });
  res.cookie(COOKIE, token, { ...cookieOpts, maxAge: SESSION_MS });
  await audit({ query: q }, user.id, 'LOGIN', 'user', user.id, {}, req).catch(() => {});
  res.json({ message: 'Signed in.', role: user.role });
});

app.post('/api/auth/logout', (_req, res) => { res.clearCookie(COOKIE, cookieOpts); res.json({ message: 'Signed out.' }); });

/* ---------- Member ---------- */
app.get('/api/me', requireAuth, async (req, res) => {
  const { rows } = await q(`SELECT u.id, u.email, u.role, u.status, u.email_verified, u.created_at,
      m.full_name, m.date_of_birth, m.gender, m.phone, m.address, m.ministry, m.profile_photo_key,
      b.id AS branch_id, b.name AS branch_name, b.location AS branch_location
    FROM users u JOIN members m ON m.user_id=u.id LEFT JOIN branches b ON b.id=m.branch_id WHERE u.id=$1`, [req.user.sub]);
  if (!rows[0]) return res.status(404).json({ message: 'Member profile not found.' });
  res.json(rows[0]);
});

app.get('/api/member/photo', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT profile_photo_key, profile_photo_mime FROM members WHERE user_id=$1', [req.user.sub]);
  await sendPhoto(res, rows[0]?.profile_photo_key, rows[0]?.profile_photo_mime);
});

app.get('/api/member/activity', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT action, created_at FROM audit_logs WHERE actor_user_id=$1 ORDER BY created_at DESC LIMIT 10', [req.user.sub]);
  res.json(rows);
});

/* ---------- Admin: registrations ---------- */
app.get('/api/admin/registrations', requireAuth, requireAdmin, async (req, res) => {
  const status = String(req.query.status || 'PENDING').toUpperCase();
  if (!['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'].includes(status)) return res.status(400).json({ message: 'Invalid status.' });
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const params = [status]; let extra = '';
  if (scope) { params.push(scope); extra = ' AND m.branch_id=$2'; }
  const { rows } = await q(`SELECT u.id, u.email, u.status, u.created_at, m.full_name, m.phone, m.ministry, m.profile_photo_key, b.name AS branch_name
    FROM users u JOIN members m ON m.user_id=u.id LEFT JOIN branches b ON b.id=m.branch_id
    WHERE u.status=$1${extra} ORDER BY u.created_at DESC LIMIT 500`, params);
  res.json(rows);
});

async function loadMemberForAdmin(req, res) {
  const scope = await branchScope(req, res); if (scope === undefined) return null;
  const { rows } = await q(`SELECT u.id, u.email, u.status, u.email_verified, u.created_at, m.full_name, m.date_of_birth, m.gender, m.phone, m.address, m.ministry,
      m.profile_photo_key, m.profile_photo_mime, m.branch_id, b.name AS branch_name, b.location AS branch_location
    FROM users u JOIN members m ON m.user_id=u.id LEFT JOIN branches b ON b.id=m.branch_id WHERE u.id=$1`, [req.params.id]);
  const item = rows[0];
  if (!item) { res.status(404).json({ message: 'Member not found.' }); return null; }
  if (scope && item.branch_id !== scope) { res.status(403).json({ message: 'You can only manage members of your own branch.' }); return null; }
  return item;
}

app.get('/api/admin/registrations/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Invalid id.' });
  const item = await loadMemberForAdmin(req, res); if (item) res.json(item);
});

app.get('/api/admin/photo/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).end();
  const item = await loadMemberForAdmin(req, res); if (item) await sendPhoto(res, item.profile_photo_key, item.profile_photo_mime);
});

app.patch('/api/admin/registrations/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const p = z.object({ status: z.enum(['ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED']) }).safeParse(req.body);
  if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Invalid request.' });
  const item = await loadMemberForAdmin(req, res); if (!item) return;
  if (item.id === req.user.sub) return res.status(400).json({ message: 'You cannot change your own status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2', [p.data.status, item.id]);
    await audit(client, req.user.sub, `MEMBER_STATUS_${p.data.status}`, 'user', item.id, { from: item.status, to: p.data.status }, req);
    await client.query('COMMIT');
    res.json({ message: `Member is now ${p.data.status.toLowerCase()}.`, status: p.data.status });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
});

/* ---------- Finance ---------- */
const recordSchema = z.object({
  type: z.enum(['TITHE', 'OFFERING', 'DUES']),
  amount: z.coerce.number().positive('Enter an amount above zero').max(100000000),
  paymentMethod: z.string().trim().min(2).max(40),
  reference: emptyToUndef(z.string().trim().max(120)),
  description: emptyToUndef(z.string().trim().max(500))
});

app.get('/api/finance/my-records', requireAuth, async (req, res) => {
  const { rows } = await q(`SELECT id,type,amount,currency,payment_method,reference,description,status,paid_at,verified_at
    FROM financial_records WHERE member_user_id=$1 ORDER BY paid_at DESC LIMIT 100`, [req.user.sub]);
  res.json(rows);
});

app.post('/api/finance/records', requireAuth, async (req, res) => {
  const p = recordSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data;
  const m = (await q('SELECT branch_id FROM members WHERE user_id=$1', [req.user.sub])).rows[0];
  if (!m) return res.status(404).json({ message: 'Member profile not found.' });
  try {
    const { rows } = await q(`INSERT INTO financial_records(member_user_id,branch_id,type,amount,currency,payment_method,reference,description,status,recorded_by)
      VALUES($1,$2,$3,$4,'GHS',$5,$6,$7,'PENDING',$1) RETURNING id,type,amount,currency,payment_method,reference,status,paid_at`,
      [req.user.sub, m.branch_id, d.type, d.amount, d.paymentMethod, d.reference || null, d.description || null]);
    await audit({ query: q }, req.user.sub, 'FINANCE_RECORD_CREATED', 'financial_record', rows[0].id, { type: d.type, amount: d.amount }, req);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'That payment reference has already been used.' });
    throw e;
  }
});

app.get('/api/admin/finance', requireAuth, requireFinanceAdmin, async (req, res) => {
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const status = String(req.query.status || 'ALL').toUpperCase(), type = String(req.query.type || 'ALL').toUpperCase();
  const params = [], where = [];
  if (['PENDING', 'VERIFIED', 'FAILED', 'REVERSED'].includes(status)) { params.push(status); where.push(`f.status=$${params.length}`); }
  if (['TITHE', 'OFFERING', 'DUES'].includes(type)) { params.push(type); where.push(`f.type=$${params.length}`); }
  if (scope) { params.push(scope); where.push(`f.branch_id=$${params.length}`); }
  const { rows } = await q(`SELECT f.id,f.type,f.amount,f.currency,f.payment_method,f.reference,f.description,f.status,f.paid_at,f.verified_at,
      m.full_name, b.name AS branch_name, u.email
    FROM financial_records f LEFT JOIN members m ON m.user_id=f.member_user_id LEFT JOIN branches b ON b.id=f.branch_id LEFT JOIN users u ON u.id=f.member_user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.paid_at DESC LIMIT 500`, params);
  res.json(rows);
});

app.get('/api/admin/finance/summary', requireAuth, requireFinanceAdmin, async (req, res) => {
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const params = []; let clause = `WHERE status='VERIFIED'`;
  if (scope) { params.push(scope); clause += ` AND branch_id=$1`; }
  const { rows } = await q(`SELECT type, COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS count FROM financial_records ${clause} GROUP BY type ORDER BY type`, params);
  res.json(rows);
});

app.patch('/api/admin/finance/:id/status', requireAuth, requireFinanceAdmin, async (req, res) => {
  const p = z.object({ status: z.enum(['VERIFIED', 'FAILED', 'REVERSED']) }).safeParse(req.body);
  if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Invalid request.' });
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query('SELECT * FROM financial_records WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!r) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Record not found.' }); }
    if (scope && r.branch_id !== scope) { await client.query('ROLLBACK'); return res.status(403).json({ message: 'You can only manage your own branch.' }); }
    if (r.recorded_by === req.user.sub && req.user.role !== 'SUPER_ADMIN') { await client.query('ROLLBACK'); return res.status(403).json({ message: 'Another finance officer must verify your own record.' }); }
    const allowed = { PENDING: ['VERIFIED', 'FAILED'], VERIFIED: ['REVERSED'] }[r.status] || [];
    if (!allowed.includes(p.data.status)) { await client.query('ROLLBACK'); return res.status(400).json({ message: `A ${r.status.toLowerCase()} record cannot be marked ${p.data.status.toLowerCase()}.` }); }
    await client.query('UPDATE financial_records SET status=$1, verified_by=$2, verified_at=NOW() WHERE id=$3', [p.data.status, req.user.sub, r.id]);
    await audit(client, req.user.sub, `FINANCE_${p.data.status}`, 'financial_record', r.id, { from: r.status, to: p.data.status }, req);
    await client.query('COMMIT');
    res.json({ message: `Record marked ${p.data.status.toLowerCase()}.`, status: p.data.status });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
});

/* ---------- Admin: messages ---------- */
app.get('/api/admin/messages', requireAuth, requireChurchAdmin, async (_req, res) => {
  const { rows } = await q('SELECT id,name,email,phone,topic,body,handled,created_at FROM messages ORDER BY handled, created_at DESC LIMIT 200');
  res.json(rows);
});
app.patch('/api/admin/messages/:id', requireAuth, requireChurchAdmin, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Invalid id.' });
  await q('UPDATE messages SET handled = NOT handled WHERE id=$1', [req.params.id]);
  res.json({ message: 'Updated.' });
});

/* ---------- Fallbacks ---------- */
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((_req, res) => res.redirect('/'));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (max 4 MB).' : 'Photo upload failed.' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.' });
});

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`KGC running at http://localhost:${PORT}`));
}
export default app;
