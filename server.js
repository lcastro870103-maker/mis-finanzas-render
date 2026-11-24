require('dotenv').config();

const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const path = require('path');
const cookieSession = require('cookie-session');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const demoPassword = process.env.DEMO_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const cookieSecure = process.env.COOKIE_SECURE === 'true';

if (!process.env.DATABASE_URL) {
  throw new Error('Configura DATABASE_URL en las variables de entorno.');
}
if (!demoPassword || demoPassword.length < 12 || /^replace[-_]/i.test(demoPassword)) {
  throw new Error('Configura DEMO_PASSWORD con una contraseña única de al menos 12 caracteres.');
}
if (!sessionSecret || sessionSecret.length < 32 || /^replace[-_]/i.test(sessionSecret)) {
  throw new Error('Configura SESSION_SECRET con al menos 32 caracteres aleatorios.');
}
if (
  process.env.COOKIE_SECURE !== undefined &&
  process.env.COOKIE_SECURE !== 'true' &&
  process.env.COOKIE_SECURE !== 'false'
) {
  throw new Error('COOKIE_SECURE debe ser true o false.');
}
if (process.env.NODE_ENV === 'production' && !cookieSecure) {
  throw new Error('Configura COOKIE_SECURE=true en producción.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', () => {
  console.error('Se produjo un error inesperado en una conexión de PostgreSQL.');
});

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'style-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'style-src-attr': ["'unsafe-inline'"],
        'font-src': ["'self'", 'https://cdn.jsdelivr.net']
      }
    }
  })
);
app.use(
  cookieSession({
    name: 'mis-finanzas-session',
    keys: [sessionSecret],
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax'
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getSession(req) {
  if (!req.session) {
    req.session = {};
  }
  return req.session;
}

function createCsrfToken() {
  return randomBytes(32).toString('hex');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function passwordMatches(candidate) {
  if (typeof candidate !== 'string') {
    return false;
  }
  const candidateHash = createHash('sha256').update(candidate).digest();
  const passwordHash = createHash('sha256').update(demoPassword).digest();
  return timingSafeEqual(candidateHash, passwordHash);
}

function requireCsrf(req, res, next) {
  const expected = req.session && req.session.csrfToken;
  if (!safeEqual(expected, req.get('x-csrf-token'))) {
    return res.status(403).json({ error: 'La solicitud no superó la validación CSRF.' });
  }
  next();
}

function requireAuthentication(req, res, next) {
  if (!req.session || req.session.authenticated !== true) {
    return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera antes de volver a intentarlo.' }
});

app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  if (typeof session.csrfToken !== 'string') {
    session.csrfToken = createCsrfToken();
  }
  res.json({
    authenticated: session.authenticated === true,
    csrfToken: session.csrfToken
  });
});

app.post('/api/auth/login', loginLimiter, requireCsrf, (req, res) => {
  if (!passwordMatches(req.body && req.body.password)) {
    return res.status(401).json({ error: 'La contraseña no es correcta.' });
  }
  req.session = {
    authenticated: true,
    csrfToken: createCsrfToken()
  };
  res.json({ authenticated: true, csrfToken: req.session.csrfToken });
});

app.post('/api/auth/logout', requireAuthentication, requireCsrf, (req, res) => {
  req.session = { csrfToken: createCsrfToken() };
  res.json({ authenticated: false, csrfToken: req.session.csrfToken });
});

app.use('/api', requireAuthentication, (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  requireCsrf(req, res, next);
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseMonth(value) {
  if (value === undefined) {
    return { month: null, start: null, end: null };
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return null;
  }

  const [year, month] = value.split('-').map(Number);
  if (year < 1) {
    return null;
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    month: value,
    start: `${value}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  };
}

function parseMovement(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Envía los datos del movimiento.' };
  }

  const { fecha, concepto, categoria, tipo, monto } = body;
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: 'La fecha no es válida.' };
  }
  const parsedDate = new Date(`${fecha}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCFullYear() < 1 ||
    parsedDate.toISOString().slice(0, 10) !== fecha
  ) {
    return { error: 'La fecha no es válida.' };
  }
  if (typeof concepto !== 'string' || !concepto.trim() || concepto.trim().length > 120) {
    return { error: 'El concepto es obligatorio y debe tener máximo 120 caracteres.' };
  }
  if (typeof categoria !== 'string' || !categoria.trim() || categoria.trim().length > 60) {
    return { error: 'La categoría es obligatoria y debe tener máximo 60 caracteres.' };
  }
  if (tipo !== 'ingreso' && tipo !== 'gasto') {
    return { error: 'El tipo debe ser ingreso o gasto.' };
  }
  const amountText = typeof monto === 'number' ? String(monto) : monto;
  if (
    typeof amountText !== 'string' ||
    !/^\d{1,10}(?:\.\d{1,2})?$/.test(amountText) ||
    !Number.isFinite(Number(amountText)) ||
    Number(amountText) <= 0
  ) {
    return { error: 'El monto debe ser mayor que cero y tener hasta dos decimales.' };
  }

  return {
    value: [
      fecha,
      concepto.trim(),
      categoria.trim(),
      tipo,
      Number(amountText).toFixed(2)
    ]
  };
}

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

async function getMovements(filter) {
  if (filter.month) {
    const result = await pool.query(
      `SELECT id, fecha, concepto, categoria, tipo, monto
       FROM movimientos
       WHERE fecha >= $1::date AND fecha < $2::date
       ORDER BY fecha DESC, id DESC`,
      [filter.start, filter.end]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT id, fecha, concepto, categoria, tipo, monto
     FROM movimientos
     ORDER BY fecha DESC, id DESC`
  );
  return result.rows;
}

app.get(
  '/api/movimientos',
  asyncHandler(async (req, res) => {
    const filter = parseMonth(req.query.mes);
    if (!filter) {
      return res.status(400).json({ error: 'El mes debe tener el formato AAAA-MM.' });
    }

    const values = filter.month ? [filter.start, filter.end] : [];
    const where = filter.month ? 'WHERE fecha >= $1::date AND fecha < $2::date' : '';
    const [movimientos, summaryResult] = await Promise.all([
      getMovements(filter),
      pool.query(
        `SELECT
           COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos,
           COALESCE(SUM(monto) FILTER (WHERE tipo = 'gasto'), 0) AS gastos
         FROM movimientos ${where}`,
        values
      )
    ]);

    const ingresos = Number(summaryResult.rows[0].ingresos);
    const gastos = Number(summaryResult.rows[0].gastos);
    res.json({
      movimientos,
      resumen: { ingresos, gastos, saldo: ingresos - gastos }
    });
  })
);

app.get(
  '/api/movimientos/exportar.csv',
  asyncHandler(async (req, res) => {
    const filter = parseMonth(req.query.mes);
    if (!filter) {
      return res.status(400).json({ error: 'El mes debe tener el formato AAAA-MM.' });
    }
    const movimientos = await getMovements(filter);
    const rows = [
      ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Monto'],
      ...movimientos.map((movement) => [
        movement.fecha.toISOString().slice(0, 10),
        movement.tipo,
        movement.concepto,
        movement.categoria,
        Number(movement.monto).toFixed(2)
      ])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const filename = filter.month ? `movimientos-${filter.month}.csv` : 'movimientos.csv';
    res.type('text/csv; charset=utf-8');
    res.attachment(filename);
    res.send(csv);
  })
);

app.post(
  '/api/movimientos',
  asyncHandler(async (req, res) => {
    const parsed = parseMovement(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const result = await pool.query(
      `INSERT INTO movimientos (fecha, concepto, categoria, tipo, monto)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, fecha, concepto, categoria, tipo, monto`,
      parsed.value
    );
    res.status(201).json({ movimiento: result.rows[0] });
  })
);

app.put(
  '/api/movimientos/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'El identificador no es válido.' });
    }
    const parsed = parseMovement(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const result = await pool.query(
      `UPDATE movimientos
       SET fecha = $1, concepto = $2, categoria = $3, tipo = $4, monto = $5
       WHERE id = $6
       RETURNING id, fecha, concepto, categoria, tipo, monto`,
      [...parsed.value, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el movimiento.' });
    }
    res.json({ movimiento: result.rows[0] });
  })
);

app.delete(
  '/api/movimientos/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'El identificador no es válido.' });
    }
    const result = await pool.query('DELETE FROM movimientos WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No se encontró el movimiento.' });
    }
    res.status(204).end();
  })
);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud no es válido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La solicitud excede el tamaño permitido.' });
  }
  console.error('Error interno al procesar la solicitud.');
  res.status(500).json({ error: 'Ocurrió un error interno. Inténtalo más tarde.' });
});

app.listen(port, () => {
  console.log(`Mis Finanzas está disponible en el puerto ${port}.`);
});
