
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const db = require('./database');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'static-site');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('Set a secure SESSION_SECRET in .env');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL missing in .env');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(session({
  store: new pgSession({
    pool: db,
    createTableIfMissing: true,
    tableName: 'user_sessions'
  }),
  name: 'sathish.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000
  }
}));

const contentTables = ['services', 'portfolio', 'arts', 'courses'];
const editableTables = ['products', ...contentTables];

async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      product_code TEXT,
      name TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      price NUMERIC DEFAULT 0,
      image TEXT,
      description TEXT,
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Active',
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS arts (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || 'Sathish Admin';

  if (!email || !password || password.length < 12) {
    throw new Error(
      'Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in .env'
    );
  }

  const existing = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existing.rowCount === 0) {
    const passwordHash = await bcrypt.hash(password, 12);

    await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [fullName, email, passwordHash, 'Super Admin', 'Active']
    );

    console.log('Initial Super Admin created.');
  }

  console.log('Neon PostgreSQL connected; tables checked.');
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please sign in.' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.session.user?.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Super Admin access required.' });
  }
  next();
}

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter login details.' });
    }

    const result = await db.query(
      `SELECT id, full_name, email, password_hash, role, status
       FROM users WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user || user.status !== 'Active' ||
        !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid login details.' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role
      };

      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ message: 'Login successful.', user: req.session.user });
      });
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie('sathish.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    res.json({ message: 'Logged out successfully.' });
  });
});

app.get('/api/admin/users', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, full_name, email, role, status, created_at
       FROM users ORDER BY id DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Read all records for the admin dashboard.
for (const table of editableTables) {
  app.get(`/api/${table}`, requireAuth, async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT id, name, data_json FROM "${table}" ORDER BY id`
      );

      res.json({
        [table]: result.rows.map(row => ({
          ...row.data_json,
          dbId: row.id,
          name: row.name
        }))
      });
    } catch (err) {
      next(err);
    }
  });
}

// Create a record.
for (const table of editableTables) {
  app.post(`/api/${table}`, requireAuth, async (req, res, next) => {
    try {
      const item = req.body;

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ error: 'Invalid item data.' });
      }

      const name = String(
        item.name || item.title || item.serviceName || ''
      ).trim();

      if (!name) {
        return res.status(400).json({ error: 'Name or title is required.' });
      }

      let result;

      if (table === 'products') {
        result = await db.query(
          `INSERT INTO products
           (product_code, name, category, subcategory, price, image,
            description, stock, status, data_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           RETURNING id`,
          [
            String(item.product_code || item.uniqueId || item.id || ''),
            name,
            String(item.category || ''),
            String(item.subcategory || item.subCategory || ''),
            Number(item.price) || 0,
            String(item.image || ''),
            String(item.description || ''),
            Number(item.stock) || 0,
            String(item.status || 'Active'),
            JSON.stringify(item)
          ]
        );
      } else {
        result = await db.query(
          `INSERT INTO "${table}" (name, data_json)
           VALUES ($1, $2::jsonb) RETURNING id`,
          [name, JSON.stringify(item)]
        );
      }

      res.status(201).json({
        id: result.rows[0].id,
        message: 'Created successfully.'
      });
    } catch (err) {
      next(err);
    }
  });
}

// Update and delete records by database ID.
for (const table of editableTables) {
  app.put(`/api/${table}/:id`, requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const item = req.body;

      if (!Number.isInteger(id) || id < 1 ||
          !item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ error: 'Invalid ID or item.' });
      }

      const name = String(
        item.name || item.title || item.serviceName || ''
      ).trim();

      if (!name) {
        return res.status(400).json({ error: 'Name or title is required.' });
      }

      let result;

      if (table === 'products') {
        result = await db.query(
          `UPDATE products SET
           product_code=$1, name=$2, category=$3, subcategory=$4,
           price=$5, image=$6, description=$7, stock=$8,
           status=$9, data_json=$10::jsonb, updated_at=CURRENT_TIMESTAMP
           WHERE id=$11 RETURNING id`,
          [
            String(item.product_code || item.uniqueId || item.id || ''),
            name,
            String(item.category || ''),
            String(item.subcategory || item.subCategory || ''),
            Number(item.price) || 0,
            String(item.image || ''),
            String(item.description || ''),
            Number(item.stock) || 0,
            String(item.status || 'Active'),
            JSON.stringify(item),
            id
          ]
        );
      } else {
        result = await db.query(
          `UPDATE "${table}" SET name=$1, data_json=$2::jsonb,
           updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING id`,
          [name, JSON.stringify(item), id]
        );
      }

      if (!result.rowCount) {
        return res.status(404).json({ error: 'Item not found.' });
      }

      res.json({ message: 'Updated successfully.', id });
    } catch (err) {
      next(err);
    }
  });

  app.delete(`/api/${table}/:id`, requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid ID.' });
      }

      const result = await db.query(
        `DELETE FROM "${table}" WHERE id=$1`,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: 'Item not found.' });
      }

      res.json({ message: 'Deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });
}

app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Sathish Media: http://localhost:${PORT}`);
      console.log(`Admin page: http://localhost:${PORT}/admin.html`);
    });
  })
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
