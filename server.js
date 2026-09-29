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

/* ---------- Online giving: provider verification + webhooks ---------- */
async function settlePayment(reference, providerTxId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query('SELECT * FROM payment_transactions WHERE reference=$1 FOR UPDATE', [reference])).rows[0];
    if (!t) { await client.query('ROLLBACK'); return false; }
    if (t.status !== 'VERIFIED') {
      await client.query(`UPDATE payment_transactions SET status='VERIFIED', provider_transaction_id=$1, verified_at=NOW() WHERE reference=$2`, [String(providerTxId), reference]);
      await client.query(`INSERT INTO financial_records(member_user_id,branch_id,type,amount,currency,payment_method,reference,description,status,verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'VERIFIED',NOW()) ON CONFLICT(reference) DO NOTHING`,
        [t.member_user_id, t.branch_id, t.type, t.amount, t.currency, 'ONLINE_' + t.provider, reference, 'Online giving via ' + t.provider]);
      if (t.member_user_id) await client.query(`INSERT INTO notifications(user_id,title,body,type) VALUES($1,$2,$3,'GIVING')`,
        [t.member_user_id, 'Thank you for your giving', `Your ${t.type.toLowerCase()} of ${t.currency} ${Number(t.amount).toFixed(2)} was received. God bless you.`]);
      await client.query(`INSERT INTO audit_logs(actor_user_id,action,target_type,metadata) VALUES($1,'ONLINE_PAYMENT_VERIFIED','payment_transaction',$2)`, [t.member_user_id, { reference, provider: t.provider }]);
    }
    await client.query('COMMIT');
    return true;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

async function verifyPaystack(reference) {
  const key = process.env.PAYSTACK_SECRET_KEY; if (!reference || !key) return false;
  const t = (await q('SELECT * FROM payment_transactions WHERE reference=$1', [reference])).rows[0];
  if (!t) return false; if (t.status === 'VERIFIED') return true;
  const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!resp.ok) return false;
  const body = await resp.json(), d = body.data;
  // never trust the redirect: the provider must confirm success, the exact reference, amount and currency
  if (!body.status || d?.status !== 'success' || d.reference !== reference || Number(d.amount) !== Math.round(Number(t.amount) * 100) || d.currency !== t.currency) return false;
  return settlePayment(reference, d.id);
}

async function verifyFlutterwave(transactionId, expectedRef) {
  const key = process.env.FLW_SECRET_KEY; if (!transactionId || !key) return false;
  const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, { headers: { Authorization: `Bearer ${key}` } });
  if (!resp.ok) return false;
  const body = await resp.json(), d = body.data;
  if (body.status !== 'success' || d?.status !== 'successful') return false;
  if (expectedRef && d.tx_ref !== expectedRef) return false;
  const t = (await q('SELECT * FROM payment_transactions WHERE reference=$1', [d.tx_ref])).rows[0];
  if (!t) return false; if (t.status === 'VERIFIED') return true;
  if (d.currency !== t.currency || Number(d.amount) < Number(t.amount)) return false;
  return settlePayment(d.tx_ref, d.id);
}

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

app.post('/api/payments/paystack/webhook', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY, sig = req.headers['x-paystack-signature'];
    if (!secret || !sig || !Buffer.isBuffer(req.body)) return res.status(401).end();
    if (!safeEq(sig, crypto.createHmac('sha512', secret).update(req.body).digest('hex'))) return res.status(401).end();
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success') await verifyPaystack(event.data?.reference);
    res.sendStatus(200);
  } catch (e) { console.error('Paystack webhook error:', e.message); res.status(400).end(); }
});

app.post('/api/payments/flutterwave/webhook', express.json({ limit: '100kb' }), async (req, res) => {
  try {
    const hash = process.env.FLW_WEBHOOK_SECRET_HASH, sent = req.headers['verif-hash'];
    if (!hash || !sent || !safeEq(sent, hash)) return res.status(401).end();
    if (req.body?.data?.id) await verifyFlutterwave(req.body.data.id, null);
    res.sendStatus(200);
  } catch (e) { console.error('Flutterwave webhook error:', e.message); res.status(400).end(); }
});

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

const BRANCH_PUBLIC = 'id, name, location, address, phone, email, service_times, facebook_url, tiktok_url, youtube_url, instagram_url';
app.get('/api/branches', async (_req, res) => {
  const { rows } = await q(`SELECT ${BRANCH_PUBLIC} FROM branches WHERE active = TRUE ORDER BY sort_order, name`);
  res.set('Cache-Control', 'public, max-age=30, s-maxage=30').json(rows);
});

const branchFilter = v => (z.string().uuid().safeParse(v).success ? v : null);
app.get('/api/events', async (req, res) => {
  const { rows } = await q(`SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location, b.name AS branch_name FROM church_events e LEFT JOIN branches b ON b.id=e.branch_id
    WHERE e.published = TRUE AND COALESCE(e.ends_at, e.starts_at + INTERVAL '3 hours') >= NOW() AND ($1::uuid IS NULL OR e.branch_id IS NULL OR e.branch_id=$1)
    ORDER BY e.starts_at LIMIT 12`, [branchFilter(req.query.branch)]);
  res.set('Cache-Control', 'public, max-age=30, s-maxage=30').json(rows);
});

app.get('/api/announcements', async (req, res) => {
  const { rows } = await q(`SELECT a.id, a.title, a.body, a.published_at, b.name AS branch_name FROM announcements a LEFT JOIN branches b ON b.id=a.branch_id
    WHERE a.published = TRUE AND ($1::uuid IS NULL OR a.branch_id IS NULL OR a.branch_id=$1) ORDER BY a.published_at DESC LIMIT 10`, [branchFilter(req.query.branch)]);
  res.set('Cache-Control', 'public, max-age=30, s-maxage=30').json(rows);
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
    if (p.data.status === 'ACTIVE') await client.query(`INSERT INTO notifications(user_id,title,body,type) VALUES($1,'Welcome to KGC','Your membership has been approved. We are glad you are part of the family.','WELCOME')`, [item.id]);
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


/* ---------- Member: notifications + online giving ---------- */
app.get('/api/member/notifications', requireAuth, async (req, res) => {
  const { rows } = await q('SELECT id,title,body,type,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.sub]);
  res.json(rows);
});
app.patch('/api/member/notifications/read-all', requireAuth, async (req, res) => {
  await q('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1 AND read_at IS NULL', [req.user.sub]);
  res.json({ message: 'All notifications marked as read.' });
});
app.patch('/api/member/notifications/:id/read', requireAuth, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Invalid id.' });
  await q('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
  res.json({ message: 'Marked as read.' });
});

app.get('/api/payments/config', (_req, res) => res.json({ paystack: !!process.env.PAYSTACK_SECRET_KEY, flutterwave: !!process.env.FLW_SECRET_KEY }));

const baseUrl = req => (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
app.post('/api/payments/create', requireAuth, async (req, res) => {
  const p = z.object({
    provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']), type: z.enum(['TITHE', 'OFFERING', 'DUES']),
    amount: z.coerce.number().min(1, 'Minimum amount is GHS 1').max(1000000), source: z.enum(['web', 'app']).default('web')
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data;
  if ((d.provider === 'PAYSTACK' && !process.env.PAYSTACK_SECRET_KEY) || (d.provider === 'FLUTTERWAVE' && !process.env.FLW_SECRET_KEY))
    return res.status(503).json({ message: `${d.provider === 'PAYSTACK' ? 'Paystack' : 'Flutterwave'} is not switched on yet. Please choose another option or contact the church office.` });
  const me = (await q('SELECT u.email, m.full_name, m.branch_id FROM users u JOIN members m ON m.user_id=u.id WHERE u.id=$1', [req.user.sub])).rows[0];
  if (!me) return res.status(404).json({ message: 'Member profile not found.' });
  const reference = `KGC-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  await q(`INSERT INTO payment_transactions(reference,provider,member_user_id,branch_id,type,amount,currency,donor_name,donor_email) VALUES($1,$2,$3,$4,$5,$6,'GHS',$7,$8)`,
    [reference, d.provider, req.user.sub, me.branch_id, d.type, d.amount, me.full_name, me.email]);
  const back = `${baseUrl(req)}/payment-result.html?provider=${d.provider}&reference=${encodeURIComponent(reference)}&from=${d.source}`;
  try {
    let url;
    if (d.provider === 'PAYSTACK') {
      const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: me.email, amount: String(Math.round(d.amount * 100)), currency: 'GHS', reference, callback_url: back, channels: ['card', 'mobile_money', 'bank', 'ussd'], metadata: { type: d.type } }) });
      const b = await r.json(); if (!r.ok || !b.status) throw new Error(b.message || 'Paystack initialisation failed'); url = b.data.authorization_url;
    } else {
      const r = await fetch('https://api.flutterwave.com/v3/payments', { method: 'POST', headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: reference, amount: d.amount, currency: 'GHS', redirect_url: back, customer: { email: me.email, name: me.full_name }, payment_options: 'card,mobilemoneyghana', customizations: { title: 'Kingdom Glory Church Giving' } }) });
      const b = await r.json(); if (!r.ok || b.status !== 'success') throw new Error(b.message || 'Flutterwave initialisation failed'); url = b.data.link;
    }
    await q('UPDATE payment_transactions SET checkout_url=$1 WHERE reference=$2', [url, reference]);
    res.json({ reference, checkoutUrl: url });
  } catch (e) {
    console.error('Payment start failed:', e.message);
    await q(`UPDATE payment_transactions SET status='FAILED' WHERE reference=$1`, [reference]);
    res.status(502).json({ message: 'We could not start the payment. Please try again in a moment.' });
  }
});

app.get('/api/payments/status/:reference', async (req, res) => {
  const ref = String(req.params.reference).slice(0, 120);
  const get = async () => (await q('SELECT reference,provider,type,amount,currency,status,created_at,verified_at FROM payment_transactions WHERE reference=$1', [ref])).rows[0];
  let t = await get(); if (!t) return res.status(404).json({ message: 'Payment not found.' });
  if (t.status === 'PENDING') {
    try {
      if (t.provider === 'PAYSTACK') await verifyPaystack(ref);
      else if (req.query.transaction_id) await verifyFlutterwave(String(req.query.transaction_id), ref);
    } catch (e) { console.error('Status verify failed:', e.message); }
    t = await get();
  }
  res.json(t);
});

/* ---------- Admin: events, announcements, branches ---------- */
const nullableUuid = z.preprocess(v => (v === '' ? null : v), z.string().uuid().nullable().optional());
const eventSchema = z.object({
  title: z.string().trim().min(2).max(180), description: emptyToUndef(z.string().trim().max(5000)), location: emptyToUndef(z.string().trim().max(255)),
  startsAt: z.coerce.date(), endsAt: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  branchId: nullableUuid, published: z.boolean().default(false)
});
const annSchema = z.object({ title: z.string().trim().min(2).max(180), body: z.string().trim().min(2).max(10000), branchId: nullableUuid, published: z.boolean().default(false) });
const idOk = (req, res) => z.string().uuid().safeParse(req.params.id).success || (res.status(400).json({ message: 'Invalid id.' }), false);

// a branch admin may only touch their own branch; church admins may touch everything
async function scopedBranchId(req, res, requested) {
  const scope = await branchScope(req, res); if (scope === undefined) return undefined;
  return scope ? scope : (requested || null);
}
async function ownsRow(req, res, table, id) {
  const row = (await q(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
  if (!row) { res.status(404).json({ message: 'Not found.' }); return null; }
  const scope = await branchScope(req, res); if (scope === undefined) return null;
  if (scope && row.branch_id !== scope) { res.status(403).json({ message: 'You can only manage your own branch.' }); return null; }
  return row;
}
async function notifyMembers(branchId, title, body) {
  await q(`INSERT INTO notifications(user_id,title,body,type) SELECT u.id,$1,$2,'ANNOUNCEMENT' FROM users u JOIN members m ON m.user_id=u.id WHERE u.status='ACTIVE' AND ($3::uuid IS NULL OR m.branch_id=$3)`,
    [title, body.slice(0, 300), branchId]);
}

app.get('/api/admin/events', requireAuth, requireAdmin, async (req, res) => {
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const { rows } = await q(`SELECT e.*, b.name AS branch_name FROM church_events e LEFT JOIN branches b ON b.id=e.branch_id WHERE ($1::uuid IS NULL OR e.branch_id=$1) ORDER BY e.starts_at DESC LIMIT 300`, [scope]);
  res.json(rows);
});
app.post('/api/admin/events', requireAuth, requireAdmin, async (req, res) => {
  const p = eventSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data, branchId = await scopedBranchId(req, res, d.branchId); if (branchId === undefined) return;
  const { rows } = await q(`INSERT INTO church_events(title,description,location,starts_at,ends_at,branch_id,published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [d.title, d.description || null, d.location || null, d.startsAt, d.endsAt || null, branchId, d.published, req.user.sub]);
  await audit({ query: q }, req.user.sub, 'EVENT_CREATED', 'church_event', rows[0].id, { title: d.title }, req);
  res.status(201).json(rows[0]);
});
app.patch('/api/admin/events/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!idOk(req, res)) return;
  const p = z.object({ published: z.boolean() }).safeParse(req.body); if (!p.success) return res.status(400).json({ message: 'Invalid update.' });
  const row = await ownsRow(req, res, 'church_events', req.params.id); if (!row) return;
  await q('UPDATE church_events SET published=$1, updated_at=NOW() WHERE id=$2', [p.data.published, row.id]);
  await audit({ query: q }, req.user.sub, p.data.published ? 'EVENT_PUBLISHED' : 'EVENT_UNPUBLISHED', 'church_event', row.id, {}, req);
  res.json({ message: p.data.published ? 'Event published.' : 'Event hidden.' });
});
app.delete('/api/admin/events/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!idOk(req, res)) return; const row = await ownsRow(req, res, 'church_events', req.params.id); if (!row) return;
  await q('DELETE FROM church_events WHERE id=$1', [row.id]); await audit({ query: q }, req.user.sub, 'EVENT_DELETED', 'church_event', row.id, {}, req);
  res.json({ message: 'Event deleted.' });
});

app.get('/api/admin/announcements', requireAuth, requireAdmin, async (req, res) => {
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const { rows } = await q(`SELECT a.*, b.name AS branch_name FROM announcements a LEFT JOIN branches b ON b.id=a.branch_id WHERE ($1::uuid IS NULL OR a.branch_id=$1) ORDER BY a.created_at DESC LIMIT 300`, [scope]);
  res.json(rows);
});
app.post('/api/admin/announcements', requireAuth, requireAdmin, async (req, res) => {
  const p = annSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data, branchId = await scopedBranchId(req, res, d.branchId); if (branchId === undefined) return;
  const { rows } = await q(`INSERT INTO announcements(title,body,branch_id,published,published_at,created_by) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NOW() END,$5) RETURNING *`, [d.title, d.body, branchId, d.published, req.user.sub]);
  await audit({ query: q }, req.user.sub, 'ANNOUNCEMENT_CREATED', 'announcement', rows[0].id, { title: d.title }, req);
  if (d.published) await notifyMembers(branchId, d.title, d.body);
  res.status(201).json(rows[0]);
});
app.patch('/api/admin/announcements/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!idOk(req, res)) return;
  const p = z.object({ published: z.boolean() }).safeParse(req.body); if (!p.success) return res.status(400).json({ message: 'Invalid update.' });
  const row = await ownsRow(req, res, 'announcements', req.params.id); if (!row) return;
  await q(`UPDATE announcements SET published=$1, published_at=CASE WHEN $1 THEN COALESCE(published_at,NOW()) END, updated_at=NOW() WHERE id=$2`, [p.data.published, row.id]);
  await audit({ query: q }, req.user.sub, p.data.published ? 'ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_UNPUBLISHED', 'announcement', row.id, {}, req);
  if (p.data.published && !row.published_at) await notifyMembers(row.branch_id, row.title, row.body);
  res.json({ message: p.data.published ? 'Announcement published.' : 'Announcement hidden.' });
});
app.delete('/api/admin/announcements/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!idOk(req, res)) return; const row = await ownsRow(req, res, 'announcements', req.params.id); if (!row) return;
  await q('DELETE FROM announcements WHERE id=$1', [row.id]); await audit({ query: q }, req.user.sub, 'ANNOUNCEMENT_DELETED', 'announcement', row.id, {}, req);
  res.json({ message: 'Announcement deleted.' });
});

// Branch details (address, phone, social links) — edit any time from the admin dashboard
const urlField = z.preprocess(v => (v === '' || v == null ? null : v), z.string().trim().max(500).refine(u => /^https?:\/\/[^\s]+$/i.test(u), 'Links must start with https://').nullable().optional());
const textField = (n) => z.preprocess(v => (v === '' || v == null ? null : v), z.string().trim().max(n).nullable().optional());
const branchFields = z.object({
  address: textField(1000), phone: textField(60), email: z.preprocess(v => (v === '' || v == null ? null : v), z.string().trim().email().max(320).nullable().optional()),
  service_times: textField(255), facebook_url: urlField, tiktok_url: urlField, youtube_url: urlField, instagram_url: urlField
});
const branchAdminOnly = z.object({ name: z.string().trim().min(2).max(120), location: textField(255), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(999) }).partial();

app.get('/api/admin/branches', requireAuth, requireAdmin, async (req, res) => {
  const scope = await branchScope(req, res); if (scope === undefined) return;
  const { rows } = await q(`SELECT id, name, location, active, sort_order, ${BRANCH_PUBLIC.split(', ').slice(3).join(', ')} FROM branches WHERE ($1::uuid IS NULL OR id=$1) ORDER BY sort_order, name`, [scope]);
  res.json(rows);
});
app.post('/api/admin/branches', requireAuth, requireChurchAdmin, async (req, res) => {
  const p = branchFields.extend({ name: z.string().trim().min(2).max(120), location: textField(255) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const d = p.data;
  try {
    const { rows } = await q(`INSERT INTO branches(name,location,address,phone,email,service_times,facebook_url,tiktok_url,youtube_url,instagram_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [d.name, d.location ?? null, d.address ?? null, d.phone ?? null, d.email ?? null, d.service_times ?? null, d.facebook_url ?? null, d.tiktok_url ?? null, d.youtube_url ?? null, d.instagram_url ?? null]);
    await audit({ query: q }, req.user.sub, 'BRANCH_CREATED', 'branch', rows[0].id, { name: d.name }, req);
    res.status(201).json({ message: 'Branch added.', id: rows[0].id });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'A branch with that name already exists.' }); throw e; }
});
app.patch('/api/admin/branches/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!idOk(req, res)) return;
  const scope = await branchScope(req, res); if (scope === undefined) return;
  if (scope && scope !== req.params.id) return res.status(403).json({ message: 'You can only edit your own branch.' });
  const schema = scope ? branchFields : branchFields.extend(branchAdminOnly.shape);
  const p = schema.partial().safeParse(req.body); if (!p.success) return res.status(400).json({ message: firstIssue(p.error) });
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(p.data)) { if (v === undefined) continue; vals.push(v); sets.push(`${k}=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ message: 'Nothing to update.' });
  vals.push(req.params.id);
  try {
    const r = await q(`UPDATE branches SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
    if (!r.rowCount) return res.status(404).json({ message: 'Branch not found.' });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'A branch with that name already exists.' }); throw e; }
  await audit({ query: q }, req.user.sub, 'BRANCH_UPDATED', 'branch', req.params.id, { fields: Object.keys(p.data) }, req);
  res.json({ message: 'Branch saved.' });
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
