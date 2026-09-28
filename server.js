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
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { z } from 'zod';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './private_uploads');
fs.mkdirSync(uploadDir, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('WARNING: Set JWT_SECRET to a random value of at least 32 characters before production.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(express.static('.'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowedMime.has(file.mimetype))
});

const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  dateOfBirth: z.string().optional(),
  gender: z.string().trim().max(30).optional(),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(320),
  address: z.string().trim().max(1000).optional(),
  branchId: z.string().uuid().optional(),
  ministry: z.string().trim().max(120).optional(),
  password: z.string().min(12).max(128),
  terms: z.enum(['true','on','1'])
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, status: user.status }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function requireAuth(req, res, next) {
  const token = req.cookies.kgc_access;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Session expired. Please log in again.' }); }
}

function requireAdmin(req, res, next) {
  if (!['SUPER_ADMIN','CHURCH_ADMIN','BRANCH_ADMIN'].includes(req.user.role)) return res.status(403).json({ message: 'Administrator access required.' });
  next();
}

async function audit(client, actor, action, targetType, targetId, metadata = {}, req) {
  await client.query(`INSERT INTO audit_logs(actor_user_id, action, target_type, target_id, metadata, ip_address) VALUES($1,$2,$3,$4,$5,$6)`, [actor || null, action, targetType || null, targetId || null, metadata, req.ip]);
}

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'kgc-api' }); }
  catch { res.status(503).json({ ok: false, service: 'kgc-api' }); }
});

app.get('/api/branches', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, location FROM branches WHERE active = TRUE ORDER BY name');
  res.json(rows);
});

app.post('/api/auth/register', registrationLimiter, upload.single('profilePhoto'), async (req, res) => {
  let client;
  try {
    const data = registrationSchema.parse(req.body);
    if (req.file && !allowedMime.has(req.file.mimetype)) throw new Error('Unsupported photo type');

    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [data.email]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const userResult = await client.query(`INSERT INTO users(email,password_hash,status) VALUES($1,$2,'PENDING') RETURNING id,email,status,role`, [data.email, passwordHash]);
    const user = userResult.rows[0];
    await client.query(`INSERT INTO members(user_id,branch_id,full_name,date_of_birth,gender,phone,address,ministry,profile_photo_key,profile_photo_mime,profile_photo_size) VALUES($1,$2,$3,NULLIF($4,'')::date,$5,$6,$7,$8,$9,$10,$11)`, [user.id, data.branchId || null, data.fullName, data.dateOfBirth || '', data.gender || null, data.phone, data.address || null, data.ministry || null, req.file?.filename || null, req.file?.mimetype || null, req.file?.size || null]);
    await audit(client, user.id, 'MEMBER_REGISTRATION_SUBMITTED', 'user', user.id, { status: 'PENDING' }, req);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Registration submitted. Your account is pending administrator approval.', status: 'PENDING' });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (err?.name === 'ZodError') return res.status(400).json({ message: 'Please check the registration fields.', errors: err.issues });
    console.error(err);
    res.status(500).json({ message: 'Registration could not be completed.' });
  } finally { client?.release(); }
});

app.get('/api/admin/registrations', requireAuth, requireAdmin, async (req, res) => {
  const status = String(req.query.status || 'PENDING').toUpperCase();
  const allowed = ['PENDING','ACTIVE','REJECTED','SUSPENDED','DEACTIVATED'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status.' });
  const params = [status];
  let branchClause = '';
  if (req.user.role === 'BRANCH_ADMIN') {
    params.push(req.user.sub);
    branchClause = ' AND m.branch_id = (SELECT branch_id FROM members WHERE user_id = $2)';
  }
  const { rows } = await pool.query(`SELECT u.id, u.email, u.status, u.created_at, m.full_name, m.date_of_birth, m.gender, m.phone, m.address, m.ministry, m.profile_photo_key, b.name AS branch_name, b.location AS branch_location FROM users u JOIN members m ON m.user_id=u.id LEFT JOIN branches b ON b.id=m.branch_id WHERE u.status=$1 ${branchClause} ORDER BY u.created_at DESC`, params);
  res.json(rows);
});

app.get('/api/admin/registrations/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT u.id, u.email, u.status, u.email_verified, u.created_at, m.full_name, m.date_of_birth, m.gender, m.phone, m.address, m.ministry, m.profile_photo_key, m.profile_photo_mime, b.id AS branch_id, b.name AS branch_name, b.location AS branch_location FROM users u JOIN members m ON m.user_id=u.id LEFT JOIN branches b ON b.id=m.branch_id WHERE u.id=$1`, [req.params.id]);
  const item = rows[0];
  if (!item) return res.status(404).json({ message: 'Registration not found.' });
  if (req.user.role === 'BRANCH_ADMIN') {
    const own = await pool.query('SELECT branch_id FROM members WHERE user_id=$1', [req.user.sub]);
    if (!own.rows[0]?.branch_id || own.rows[0].branch_id !== item.branch_id) return res.status(403).json({ message: 'You cannot access this branch member.' });
  }
  res.json(item);
});

app.patch('/api/admin/registrations/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const parsed = z.object({ status: z.enum(['ACTIVE','REJECTED','SUSPENDED','DEACTIVATED']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT u.id,u.status,m.branch_id FROM users u JOIN members m ON m.user_id=u.id WHERE u.id=$1 FOR UPDATE', [req.params.id]);
    const target = rows[0];
    if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Registration not found.' }); }
    if (req.user.role === 'BRANCH_ADMIN') {
      const own = await client.query('SELECT branch_id FROM members WHERE user_id=$1', [req.user.sub]);
      if (!own.rows[0]?.branch_id || own.rows[0].branch_id !== target.branch_id) { await client.query('ROLLBACK'); return res.status(403).json({ message: 'You cannot manage this branch member.' }); }
    }
    await client.query('UPDATE users SET status=$1,updated_at=NOW() WHERE id=$2', [parsed.data.status, req.params.id]);
    await audit(client, req.user.sub, `MEMBER_STATUS_${parsed.data.status}`, 'user', req.params.id, { from: target.status, to: parsed.data.status }, req);
    await client.query('COMMIT');
    res.json({ message: `Member status changed to ${parsed.data.status}.`, status: parsed.data.status });
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({ message: 'Status update failed.' }); }
  finally { client.release(); }
});



app.get('/api/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.role, u.status, u.email_verified, u.created_at,
           m.full_name, m.date_of_birth, m.gender, m.phone, m.address, m.ministry,
           m.profile_photo_key, b.id AS branch_id, b.name AS branch_name, b.location AS branch_location
    FROM users u
    JOIN members m ON m.user_id = u.id
    LEFT JOIN branches b ON b.id = m.branch_id
    WHERE u.id = $1`, [req.user.sub]);
  if (!rows[0]) return res.status(404).json({ message: 'Member profile not found.' });
  res.json(rows[0]);
});

app.get('/api/member/photo', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT profile_photo_key,profile_photo_mime FROM members WHERE user_id=$1',[req.user.sub]);
  const m = rows[0];
  if (!m?.profile_photo_key) return res.status(404).end();
  const file = path.join(uploadDir, m.profile_photo_key);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.type(m.profile_photo_mime || 'application/octet-stream');
  res.sendFile(file);
});

app.get('/api/member/activity', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT action, metadata, created_at
    FROM audit_logs
    WHERE actor_user_id = $1
    ORDER BY created_at DESC LIMIT 10`, [req.user.sub]);
  res.json(rows);
});

const financeAdminRoles=['SUPER_ADMIN','CHURCH_ADMIN','BRANCH_ADMIN','FINANCE_OFFICER'];
function requireFinanceAdmin(req,res,next){if(!financeAdminRoles.includes(req.user.role))return res.status(403).json({message:'Finance access required.'});next();}
app.get('/api/finance/my-records',requireAuth,async(req,res)=>{const{rows}=await pool.query(`SELECT id,type,amount,currency,payment_method,reference,description,status,paid_at,verified_at FROM financial_records WHERE member_user_id=$1 ORDER BY paid_at DESC LIMIT 100`,[req.user.sub]);res.json(rows);});
app.post('/api/finance/records',requireAuth,async(req,res)=>{const p=z.object({type:z.enum(['TITHE','OFFERING','DUES']),amount:z.coerce.number().positive().max(100000000),currency:z.string().length(3).default('GHS'),paymentMethod:z.string().trim().min(2).max(40),reference:z.string().trim().max(120).optional(),description:z.string().trim().max(500).optional(),memberUserId:z.string().uuid().optional(),branchId:z.string().uuid().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid financial record.',errors:p.error.issues});const d=p.data,member=d.memberUserId||req.user.sub,m=await pool.query('SELECT user_id,branch_id FROM members WHERE user_id=$1',[member]);if(!m.rows[0])return res.status(404).json({message:'Member not found.'});if(member!==req.user.sub&&!financeAdminRoles.includes(req.user.role))return res.status(403).json({message:'You can only record your own payment.'});const{rows}=await pool.query(`INSERT INTO financial_records(member_user_id,branch_id,type,amount,currency,payment_method,reference,description,status,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9) RETURNING id,type,amount,currency,payment_method,reference,status,paid_at`,[member,d.branchId||m.rows[0].branch_id,d.type,d.amount,d.currency.toUpperCase(),d.paymentMethod,d.reference||null,d.description||null,req.user.sub]);await pool.query(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata,ip_address) VALUES($1,'FINANCE_RECORD_CREATED','financial_record',$2,$3,$4)`,[req.user.sub,rows[0].id,{type:d.type,amount:d.amount,status:'PENDING'},req.ip]);res.status(201).json(rows[0]);});
app.get('/api/admin/finance',requireAuth,requireFinanceAdmin,async(req,res)=>{const status=String(req.query.status||'ALL').toUpperCase(),type=String(req.query.type||'ALL').toUpperCase(),params=[],where=[];if(['PENDING','VERIFIED','FAILED','REVERSED'].includes(status)){params.push(status);where.push(`f.status=$${params.length}`)}if(['TITHE','OFFERING','DUES'].includes(type)){params.push(type);where.push(`f.type=$${params.length}`)}if(req.user.role==='BRANCH_ADMIN'){params.push(req.user.sub);where.push(`f.branch_id=(SELECT branch_id FROM members WHERE user_id=$${params.length})`)}const{rows}=await pool.query(`SELECT f.id,f.type,f.amount,f.currency,f.payment_method,f.reference,f.description,f.status,f.paid_at,f.verified_at,m.full_name,b.name branch_name,u.email FROM financial_records f LEFT JOIN members m ON m.user_id=f.member_user_id LEFT JOIN branches b ON b.id=f.branch_id LEFT JOIN users u ON u.id=f.member_user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY f.paid_at DESC LIMIT 500`,params);res.json(rows);});
app.patch('/api/admin/finance/:id/status',requireAuth,requireFinanceAdmin,async(req,res)=>{const p=z.object({status:z.enum(['VERIFIED','FAILED','REVERSED'])}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid finance status.'});const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query('SELECT * FROM financial_records WHERE id=$1 FOR UPDATE',[req.params.id]),r=q.rows[0];if(!r){await c.query('ROLLBACK');return res.status(404).json({message:'Financial record not found.'});}if(req.user.role==='BRANCH_ADMIN'){const o=await c.query('SELECT branch_id FROM members WHERE user_id=$1',[req.user.sub]);if(!o.rows[0]?.branch_id||o.rows[0].branch_id!==r.branch_id){await c.query('ROLLBACK');return res.status(403).json({message:'You cannot manage this branch record.'});}}await c.query(`UPDATE financial_records SET status=$1,verified_by=$2,verified_at=NOW() WHERE id=$3`,[p.data.status,req.user.sub,r.id]);await audit(c,req.user.sub,`FINANCE_${p.data.status}`,'financial_record',r.id,{from:r.status,to:p.data.status},req);await c.query('COMMIT');res.json({message:`Financial record marked ${p.data.status}.`,status:p.data.status});}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e);res.status(500).json({message:'Finance status update failed.'});}finally{c.release();}});
app.get('/api/admin/finance/summary',requireAuth,requireFinanceAdmin,async(req,res)=>{const params=[];let clause=`WHERE status='VERIFIED'`;if(req.user.role==='BRANCH_ADMIN'){params.push(req.user.sub);clause+=` AND branch_id=(SELECT branch_id FROM members WHERE user_id=$${params.length})`;}const{rows}=await pool.query(`SELECT type,COALESCE(SUM(amount),0)::numeric total,COUNT(*)::int count FROM financial_records ${clause} GROUP BY type ORDER BY type`,params);res.json(rows);});
app.post('/api/auth/logout', requireAuth, (req,res)=>{ res.clearCookie('kgc_access'); res.json({message:'Logged out.'}); });

app.get('/api/admin/photo/:id', requireAuth, requireAdmin, async (req,res)=>{
  const {rows}=await pool.query('SELECT m.profile_photo_key,m.profile_photo_mime,m.branch_id FROM members m WHERE m.user_id=$1',[req.params.id]); const m=rows[0];
  if(!m?.profile_photo_key) return res.status(404).end();
  if(req.user.role==='BRANCH_ADMIN'){const own=await pool.query('SELECT branch_id FROM members WHERE user_id=$1',[req.user.sub]); if(!own.rows[0]?.branch_id || own.rows[0].branch_id!==m.branch_id) return res.status(403).end();}
  const file=path.join(uploadDir,m.profile_photo_key); if(!fs.existsSync(file)) return res.status(404).end(); res.type(m.profile_photo_mime||'application/octet-stream'); res.sendFile(file);
});

app.post('/api/auth/login' , authLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid login details.' });
  const { rows } = await pool.query('SELECT id,email,password_hash,role,status FROM users WHERE LOWER(email)=LOWER($1)', [parsed.data.email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ message: 'Invalid email or password.' });
  if (user.status !== 'ACTIVE') return res.status(403).json({ message: `Account status: ${user.status}.` });
  res.cookie('kgc_access', signToken(user), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000 });
  res.json({ message: 'Login successful.', role: user.role });
});

app.use((_req, res) => res.status(404).json({ message: 'Not found' }));

app.listen(PORT, () => console.log(`KGC API listening on http://localhost:${PORT}`));
