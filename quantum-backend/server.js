require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_fallback_secret";
const APP_URL = process.env.APP_URL || "http://localhost:4000";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@bitcoincustodyuk.com").toLowerCase();
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const FRONTEND_ROOT = path.join(__dirname, "..");
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:0",
  "http://localhost:0",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "https://franchise23.github.io",
  "https://franchise23.github.io/quantum-ledger-clone",
  "https://bitcoin-custody-uk.onrender.com",
  "https://quantum-ledger-org.onrender.com",
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, "users.json"))) fs.writeFileSync(path.join(DATA_DIR, "users.json"), JSON.stringify([], null, 2));
  if (!fs.existsSync(TRANSACTIONS_FILE)) fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify([], null, 2));
}

ensureDataFiles();

const db = new Database(DB_PATH, { fileMustExist: false });
db.pragma("journal_mode = WAL");

function initDatabase() {

  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      account_status TEXT NOT NULL DEFAULT 'active',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      email_verification_sent_at TEXT,
      last_failed_login_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_created ON auth_events(created_at)`).run();
}

initDatabase();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    const normalizedOrigin = origin.toLowerCase();
    const isLocalPreview =
      normalizedOrigin.includes("localhost") ||
      normalizedOrigin.includes("127.0.0.1") ||
      normalizedOrigin.includes("::1") ||
      normalizedOrigin.includes("0");

    if (isLocalPreview || normalizedOrigin.includes("onrender.com") || normalizedOrigin.includes("github.io")) {
      return cb(null, true);
    }

    return cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
  optionsSuccessStatus: 200,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(FRONTEND_ROOT));

const SAMPLE_COMPLETED_TRANSACTIONS = [
  { id: "tx-1001", investorName: "Alicia M.", planName: "Growth Plus", amount: 2400, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
  { id: "tx-1002", investorName: "Daniel C.", planName: "Starter Capital", amount: 1500, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString() },
  { id: "tx-1003", investorName: "Renee T.", planName: "Income Max", amount: 6400, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString() },
  { id: "tx-1004", investorName: "Samuel K.", planName: "Growth Plus", amount: 3200, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 27 * 60 * 1000).toISOString() },
  { id: "tx-1005", investorName: "Priya N.", planName: "Starter Capital", amount: 950, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 41 * 60 * 1000).toISOString() },
  { id: "tx-1006", investorName: "Marcus H.", planName: "Income Max", amount: 8700, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 58 * 60 * 1000).toISOString() },
];

function loadTransactions() {
  try {
    const raw = fs.readFileSync(TRANSACTIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(SAMPLE_COMPLETED_TRANSACTIONS, null, 2));
    return SAMPLE_COMPLETED_TRANSACTIONS;
  } catch (err) {
    console.error("Error reading transaction file:", err);
    return SAMPLE_COMPLETED_TRANSACTIONS;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function isStrongPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getExpiryDate(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalized) || null;
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(id)) || null;
}

function createAuthEvent({ userId = null, email = null, eventType, outcome, reason = null, metadata = null }) {
  db.prepare(`
    INSERT INTO auth_events (user_id, email, event_type, outcome, reason, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, email, eventType, outcome, reason, metadata ? JSON.stringify(metadata) : null);
}

function sendEmail({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!host || !smtpUser || !smtpPass) {
    console.log(`EMAIL SIMULATION: to=${to} | subject=${subject}`);
    console.log(text);
    return Promise.resolve({ accepted: [to], simulated: true });
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Boolean(process.env.SMTP_SECURE === "true"),
    auth: { user: smtpUser, pass: smtpPass },
  });

  return transporter.sendMail({ from: process.env.SMTP_FROM || smtpUser, to, subject, text, html });
}

function buildUserResponse(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: !!user.email_verified,
    accountStatus: user.account_status,
    isAdmin: !!user.is_admin,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

function generateToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    isAdmin: !!user.is_admin,
  }, JWT_SECRET, { expiresIn: "8h" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [type, token] = authHeader.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.id);
    if (!user) return res.status(401).json({ error: "Session invalid. Please sign in again." });
    if (!user.email_verified) return res.status(403).json({ error: "Please verify your email before accessing your account." });
    if (user.account_status !== "active") return res.status(403).json({ error: "Your account is suspended or inactive." });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    createAuthEvent({ userId: req.user ? req.user.id : null, email: req.user ? req.user.email : null, eventType: "admin_access_denied", outcome: "denied", reason: "non_admin" });
    return res.status(403).json({ error: "Administrator access required." });
  }
  next();
}

function createVerificationToken(userId) {
  const token = randomToken();
  const expiresAt = getExpiryDate(24);
  db.prepare(`INSERT INTO verification_tokens (user_id, token, token_type, expires_at, created_at) VALUES (?, ?, 'email_verification', ?, datetime('now'))`).run(userId, token, expiresAt);
  return { token, expiresAt };
}

async function sendVerificationEmail(user) {
  const { token, expiresAt } = createVerificationToken(user.id);
  const verificationUrl = `${APP_URL}/api/verify-email?token=${token}`;
  const text = `Hello ${user.name},\n\nPlease verify your email to activate your account.\n${verificationUrl}\n\nThis link expires at: ${new Date(expiresAt).toLocaleString()}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your Bitcoin Custody UK account",
    text,
    html: `<p>Hello ${user.name},</p><p>Please verify your email to activate your account.</p><p><a href="${verificationUrl}">Verify your account</a></p><p>This link expires at: ${new Date(expiresAt).toLocaleString()}</p>`,
  });
  db.prepare(`UPDATE users SET email_verification_sent_at = datetime('now') WHERE id = ?`).run(user.id);
  return true;
}

function createResetToken(userId) {
  const token = randomToken();
  const expiresAt = getExpiryDate(2);
  db.prepare(`INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, datetime('now'))`).run(userId, token, expiresAt);
  return { token, expiresAt };
}

async function sendPasswordResetEmail(user) {
  const { token, expiresAt } = createResetToken(user.id);
  const link = `${APP_URL}/api/reset-password?token=${token}`;
  const text = `Hello ${user.name},\n\nUse this link to reset your password:\n${link}\n\nThis link expires at: ${new Date(expiresAt).toLocaleString()}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Bitcoin Custody UK password",
    text,
    html: `<p>Hello ${user.name},</p><p>Use this link to reset your password:</p><p><a href="${link}">Reset password</a></p><p>This link expires at: ${new Date(expiresAt).toLocaleString()}</p>`,
  });
  return true;
}

function upsertAdminUser() {
  const existing = getUserByEmail(ADMIN_EMAIL);
  if (!existing) {
    const passwordHash = bcrypt.hashSync("Admin@123456", 12);
    db.prepare(`INSERT INTO users (name, email, password_hash, email_verified, account_status, is_admin, created_at, last_login_at) VALUES (?, ?, ?, 1, 'active', 1, datetime('now'), datetime('now'))`).run("Bitcoin Custody UK Admin", ADMIN_EMAIL, passwordHash);
  }
}

upsertAdminUser();

app.get("/", (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "index.html")));
app.get(["/dashboard", "/dashboard.html"], (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "dashboard.html")));
app.get(["/profile", "/profile.html"], (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "profile.html")));
app.get(["/admin", "/admin.html"], authMiddleware, requireAdmin, (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "admin.html")));

app.get("/api/health", (req, res) => res.send("Bitcoin Custody UK backend is running"));

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!name || !String(name).trim()) return res.status(400).json({ error: "Full name is required." });
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) return res.status(400).json({ error: "A valid email address is required." });
    if (!isStrongPassword(password)) return res.status(400).json({ error: "Password must be at least 8 characters long." });

    if (getUserByEmail(normalizedEmail)) {
      createAuthEvent({ email: normalizedEmail, eventType: "registration", outcome: "failed", reason: "duplicate_email" });
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const insert = db.prepare(`INSERT INTO users (name, email, password_hash, email_verified, account_status, is_admin, created_at) VALUES (?, ?, ?, 0, 'active', 0, datetime('now'))`).run(String(name).trim(), normalizedEmail, passwordHash);
    const user = getUserById(insert.lastInsertRowid);
    createAuthEvent({ userId: user.id, email: user.email, eventType: "registration", outcome: "success" });

    try { await sendVerificationEmail(user); } catch (err) { console.error("Verification email failed:", err); }

    return res.status(201).json({
      message: "Registration successful. Please verify your email to activate your account.",
      user: buildUserResponse(user),
    });
  } catch (err) {
    console.error("Error in /api/register:", err);
    return res.status(500).json({ error: "Unable to create your account right now." });
  }
});

app.get("/api/verify-email", (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "Verification token is missing." });

  const tokenRow = db.prepare(`SELECT * FROM verification_tokens WHERE token = ?`).get(token);
  if (!tokenRow) {
    createAuthEvent({ eventType: "email_verification", outcome: "failed", reason: "invalid_token" });
    return res.status(400).json({ error: "Verification link is invalid or has already been used." });
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM verification_tokens WHERE token = ?`).run(token);
    createAuthEvent({ userId: tokenRow.user_id, email: getUserById(tokenRow.user_id)?.email || null, eventType: "email_verification", outcome: "failed", reason: "expired_token" });
    return res.status(410).json({ error: "Verification link has expired. Please request a new one." });
  }

  const user = getUserById(tokenRow.user_id);
  if (!user) return res.status(404).json({ error: "User not found." });

  db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(user.id);
  db.prepare(`UPDATE verification_tokens SET used_at = datetime('now') WHERE token = ?`).run(token);
  createAuthEvent({ userId: user.id, email: user.email, eventType: "email_verification", outcome: "success" });
  return res.json({ message: "Email verified successfully. You can now log in." });
});

app.post("/api/resend-verification", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required." });

  const user = getUserByEmail(email);
  if (!user) return res.status(200).json({ message: "If an account exists, a verification email has been sent." });
  if (user.email_verified) return res.status(200).json({ message: "Your email is already verified." });

  const lastSent = user.email_verification_sent_at ? new Date(user.email_verification_sent_at).getTime() : 0;
  if (Date.now() - lastSent < 60000) return res.status(429).json({ error: "Please wait a moment before requesting another verification email." });

  try {
    await sendVerificationEmail(user);
    createAuthEvent({ userId: user.id, email: user.email, eventType: "resend_verification", outcome: "success" });
    return res.status(200).json({ message: "Verification email sent successfully." });
  } catch (err) {
    console.error("Verification resend failed:", err);
    return res.status(500).json({ error: "Unable to send verification email right now." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) return res.status(400).json({ error: "A valid email address is required." });
    if (!password || !isStrongPassword(password)) return res.status(400).json({ error: "Password is required and must be at least 8 characters long." });

    const user = getUserByEmail(normalizedEmail);
    if (!user) {
      createAuthEvent({ email: normalizedEmail, eventType: "login", outcome: "failed", reason: "user_not_found" });
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      db.prepare(`UPDATE users SET last_failed_login_at = datetime('now') WHERE id = ?`).run(user.id);
      createAuthEvent({ userId: user.id, email: user.email, eventType: "login", outcome: "failed", reason: "invalid_password" });
      return res.status(400).json({ error: "Invalid email or password." });
    }

    if (!user.email_verified) {
      createAuthEvent({ userId: user.id, email: user.email, eventType: "login", outcome: "failed", reason: "unverified_email" });
      return res.status(403).json({ error: "Please verify your email before logging in." });
    }

    if (user.account_status !== "active") {
      createAuthEvent({ userId: user.id, email: user.email, eventType: "login", outcome: "failed", reason: "suspended_account" });
      return res.status(403).json({ error: "This account is suspended. Please contact support." });
    }

    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    const updatedUser = getUserById(user.id);
    const token = generateToken(updatedUser);
    createAuthEvent({ userId: updatedUser.id, email: updatedUser.email, eventType: "login", outcome: "success" });

    return res.json({ token, user: buildUserResponse(updatedUser) });
  } catch (err) {
    console.error("Error in /api/login:", err);
    return res.status(500).json({ error: "Unable to log in right now." });
  }
});

app.post("/api/logout", authMiddleware, (req, res) => {
  createAuthEvent({ userId: req.user.id, email: req.user.email, eventType: "logout", outcome: "success" });
  return res.json({ message: "Logged out successfully." });
});

app.get("/api/me", authMiddleware, (req, res) => res.json({ user: buildUserResponse(req.user) }));

app.post("/api/request-password-reset", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required." });

  const user = getUserByEmail(email);
  if (!user) return res.status(200).json({ message: "If an account exists, a password-reset email has been sent." });

  try {
    await sendPasswordResetEmail(user);
    createAuthEvent({ userId: user.id, email: user.email, eventType: "password_reset_request", outcome: "success" });
    return res.status(200).json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Password reset email failed:", err);
    return res.status(500).json({ error: "Unable to send password reset email right now." });
  }
});

app.get("/api/reset-password", (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "Reset token is required." });

  const record = db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`).get(token);
  if (!record) return res.status(400).json({ error: "Reset link is invalid or has already been used." });
  if (new Date(record.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM password_reset_tokens WHERE token = ?`).run(token);
    return res.status(410).json({ error: "Reset link has expired. Please request another reset." });
  }

  return res.json({ message: "Reset token is valid." });
});

app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required." });
  if (!isStrongPassword(password)) return res.status(400).json({ error: "Password must be at least 8 characters long." });

  const record = db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`).get(token);
  if (!record) return res.status(400).json({ error: "Reset link is invalid." });
  if (record.used_at) return res.status(400).json({ error: "This reset link has already been used." });
  if (new Date(record.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM password_reset_tokens WHERE token = ?`).run(token);
    return res.status(410).json({ error: "Reset link has expired. Please request another reset." });
  }

  const user = getUserById(record.user_id);
  if (!user) return res.status(404).json({ error: "User not found." });

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, user.id);
  db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?`).run(token);

  createAuthEvent({ userId: user.id, email: user.email, eventType: "password_reset", outcome: "success" });
  return res.json({ message: "Password updated successfully." });
});

app.get("/api/investment-plans", (req, res) => {
  const plans = [
    { id: "starter", name: "Starter Capital", roi: "12%", minimum: 500, duration: "6 months", description: "A balanced growth plan for first-time investors.", risk: "Moderate" },
    { id: "growth", name: "Growth Plus", roi: "18%", minimum: 2000, duration: "12 months", description: "Higher return potential with a diversified portfolio.", risk: "Balanced" },
    { id: "income", name: "Income Max", roi: "24%", minimum: 5000, duration: "18 months", description: "Optimized for income-focused investors seeking longer-term yield.", risk: "Premium" },
  ];
  return res.json({ plans });
});

app.get("/api/transactions", (req, res) => {
  try {
    const txs = loadTransactions().filter((tx) => tx && tx.status === "completed" && tx.isPublic !== false).sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0)).slice(0, Number(req.query.limit) || 10);
    return res.json({ transactions: txs });
  } catch (err) {
    console.error("Error loading transactions:", err);
    return res.status(500).json({ error: "Unable to load transactions" });
  }
});

async function fetchYahooChart(symbol) {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    if (!response.ok) {
      return { price: Number.NaN, changePercent: Number.NaN };
    }

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta || {};
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const lastClose = Number(closes[closes.length - 1] ?? meta.chartPreviousClose ?? meta.previousClose ?? NaN);
    const price = Number(meta.regularMarketPrice ?? lastClose ?? NaN);
    const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? lastClose ?? NaN);
    const changePercent = Number.isFinite(Number(meta.regularMarketChangePercent))
      ? Number(meta.regularMarketChangePercent)
      : Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : Number.NaN;

    return { price, changePercent };
  } catch (error) {
    console.warn(`Yahoo market fetch failed for ${symbol}:`, error);
    return { price: Number.NaN, changePercent: Number.NaN };
  }
}

async function fetchCoinGeckoPrice(id) {
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=gbp&ids=${encodeURIComponent(id)}&price_change_percentage=24h&sparkline=false`);
    if (!response.ok) {
      return { price: Number.NaN, changePercent: Number.NaN };
    }

    const data = await response.json();
    const coin = Array.isArray(data) ? data[0] : null;
    if (!coin) {
      return { price: Number.NaN, changePercent: Number.NaN };
    }

    return {
      price: Number(coin.current_price),
      changePercent: Number(coin.price_change_percentage_24h),
    };
  } catch (error) {
    console.warn(`CoinGecko fetch failed for ${id}:`, error);
    return { price: Number.NaN, changePercent: Number.NaN };
  }
}

app.get("/api/market", async (req, res) => {
  try {
    const marketSymbols = [
      { key: "SPFUT", label: "S&P FUT", symbol: "ES=F", url: "https://finance.yahoo.com/quote/ES=F" },
      { key: "NQFUT", label: "NQ FUT", symbol: "NQ=F", url: "https://finance.yahoo.com/quote/NQ=F" },
      { key: "DOWFUT", label: "DOW FUT", symbol: "YM=F", url: "https://finance.yahoo.com/quote/YM=F" },
      { key: "RUSSELL", label: "RUSSELL", symbol: "^RTY", url: "https://finance.yahoo.com/quote/%5ERTY" },
      { key: "BITCOIN", label: "BITCOIN", symbol: "BTC-USD", url: "https://finance.yahoo.com/quote/BTC-USD" },
      { key: "GOLD", label: "GOLD", symbol: "GC=F", url: "https://finance.yahoo.com/quote/GC=F" },
      { key: "SILVER", label: "SILVER", symbol: "SI=F", url: "https://finance.yahoo.com/quote/SI=F" },
      { key: "OIL", label: "CRUDE OIL", symbol: "CL=F", url: "https://finance.yahoo.com/quote/CL=F" },
      { key: "SP500", label: "S&P 500", symbol: "^GSPC", url: "https://finance.yahoo.com/quote/%5EGSPC" },
      { key: "DOWJONES", label: "DOW JONES", symbol: "^DJI", url: "https://finance.yahoo.com/quote/%5EDJI" },
      { key: "NASDAQ", label: "NASDAQ", symbol: "^IXIC", url: "https://finance.yahoo.com/quote/%5EIXIC" },
    ];

    const tickers = await Promise.all(
      marketSymbols.map(async (item) => {
        const marketData = item.key === "BITCOIN"
          ? await fetchCoinGeckoPrice("bitcoin")
          : await fetchYahooChart(item.symbol);

        return {
          key: item.key,
          label: item.label,
          price: Number.isFinite(marketData.price) ? marketData.price : Number.NaN,
          changePercent: Number.isFinite(marketData.changePercent) ? marketData.changePercent : Number.NaN,
          url: item.url,
        };
      })
    );

    return res.json({ tickers });
  } catch (error) {
    console.error("Market API failed:", error);
    return res.status(500).json({ error: "Unable to load market data." });
  }
});

app.get("/api/admin/me", authMiddleware, requireAdmin, (req, res) => res.json({ user: buildUserResponse(req.user) }));

app.get("/api/admin/users", authMiddleware, requireAdmin, (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const verified = req.query.verified;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];

  if (search) {
    where.push("(name LIKE ? OR email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("account_status = ?");
    params.push(status);
  }
  if (verified !== undefined && verified !== "") {
    where.push("email_verified = ?");
    params.push(verified === "true" ? 1 : 0);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM users ${whereClause}`).get(...params);
  const rows = db.prepare(`SELECT id, name, email, email_verified, account_status, created_at, last_login_at, is_admin FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return res.json({
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: !!row.email_verified,
      accountStatus: row.account_status,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      isAdmin: !!row.is_admin,
    })),
    page,
    total: Number(totalRow.total || 0),
    limit,
    totalPages: Math.max(1, Math.ceil((Number(totalRow.total || 0) || 1) / limit)),
  });
});

app.get("/api/admin/auth-events", authMiddleware, requireAdmin, (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const eventType = String(req.query.eventType || "").trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];
  if (userId) { where.push("user_id = ?"); params.push(userId); }
  if (eventType) { where.push("event_type = ?"); params.push(eventType); }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM auth_events ${whereClause}`).get(...params);
  const rows = db.prepare(`SELECT id, user_id, email, event_type, outcome, reason, metadata, created_at FROM auth_events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return res.json({
    events: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      eventType: row.event_type,
      outcome: row.outcome,
      reason: row.reason,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    })),
    total: Number(totalRow.total || 0),
    page,
    limit,
  });
});

app.patch("/api/admin/users/:id/status", authMiddleware, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const allowed = ["active", "suspended"];

  if (!allowed.includes(status)) return res.status(400).json({ error: "Status must be active or suspended." });

  const user = getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found." });

  db.prepare(`UPDATE users SET account_status = ? WHERE id = ?`).run(status, userId);
  createAuthEvent({ userId: user.id, email: user.email, eventType: "account_status_change", outcome: "success", reason: status });
  return res.json({ message: `User account set to ${status}.` });
});

app.get("/api/admin/export", authMiddleware, requireAdmin, (req, res) => {
  const type = String(req.query.type || "json").toLowerCase();
  const users = db.prepare(`SELECT id, name, email, email_verified, account_status, created_at, last_login_at FROM users ORDER BY created_at DESC`).all();
  const events = db.prepare(`SELECT id, user_id, email, event_type, outcome, reason, metadata, created_at FROM auth_events ORDER BY created_at DESC`).all();

  if (type === "csv") {
    const rows = [["type", "id", "user_id", "name", "email", "email_verified", "account_status", "created_at", "last_login_at", "event_type", "outcome", "reason", "metadata"]];
    users.forEach((user) => rows.push(["user", user.id, "", user.name, user.email, !!user.email_verified, user.account_status, user.created_at, user.last_login_at, "", "", "", ""]));
    events.forEach((event) => rows.push(["event", "", event.user_id, "", event.email || "", "", "", "", "", event.event_type, event.outcome, event.reason || "", event.metadata || ""]));
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=bitcoin-custody-uk-export.csv");
    return res.send(csv);
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=bitcoin-custody-uk-export.json");
  return res.json({ users, authEvents: events.map((row) => ({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null })) });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
