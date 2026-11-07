const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT || 4100);
const JWT_SECRET = process.env.JWT_SECRET || "dev_fallback_secret";
const APP_URL = process.env.APP_URL || "http://localhost:4100";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@bitcoincustodyuk.com").toLowerCase();
const EMAIL_DELIVERY_ENABLED = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const OTP_EXPIRES_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_TTL_HOURS = 2;
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
      username TEXT,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      account_status TEXT NOT NULL DEFAULT 'active',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      email_verification_sent_at TEXT,
      last_failed_login_at TEXT,
      email_verified_at TEXT
    )
  `).run();

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const requiredUserColumns = [
    { name: "username", definition: "TEXT" },
    { name: "email_verification_sent_at", definition: "TEXT" },
    { name: "last_failed_login_at", definition: "TEXT" },
    { name: "email_verified_at", definition: "TEXT" },
  ];

  requiredUserColumns.forEach(({ name, definition }) => {
    if (!userColumns.some((column) => column.name === name)) {
      db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${definition}`).run();
    }
  });

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

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      otp_expires_at TEXT NOT NULL,
      otp_attempts_used INTEGER NOT NULL DEFAULT 0,
      otp_last_attempt_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at TEXT,
      used_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_financial_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      available_balance REAL NOT NULL DEFAULT 0,
      total_invested REAL NOT NULL DEFAULT 0,
      total_returns REAL NOT NULL DEFAULT 0,
      active_investments INTEGER NOT NULL DEFAULT 0,
      total_deposits REAL NOT NULL DEFAULT 0,
      total_withdrawals REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      asset_symbol TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      average_cost_basis REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL DEFAULT 0,
      profit_loss REAL NOT NULL DEFAULT 0,
      allocation_percentage REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      duration_months INTEGER NOT NULL DEFAULT 0,
      expected_roi REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      maturity_date TEXT,
      payment_reference TEXT,
      metadata TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'pending',
      reference TEXT,
      description TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_email_lower ON pending_registrations (LOWER(email))`).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_username_lower ON pending_registrations (LOWER(username))`).run();
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

function getInvestmentPlans() {
  return [
    { id: "starter", name: "Starter Capital", roi: 12, minimum: 500, duration: "6 months", durationMonths: 6, description: "A balanced growth plan for first-time investors.", risk: "Moderate" },
    { id: "growth", name: "Growth Plus", roi: 18, minimum: 2000, duration: "12 months", durationMonths: 12, description: "Higher return potential with a diversified portfolio.", risk: "Balanced" },
    { id: "income", name: "Income Max", roi: 24, minimum: 5000, duration: "18 months", durationMonths: 18, description: "Optimized for income-focused investors seeking longer-term yield.", risk: "Premium" },
  ];
}

function getAssetReferencePrice(symbol) {
  const prices = {
    BTC: 68000,
    ETH: 3600,
    SOL: 145,
    USDT: 1,
    XRP: 0.63,
    BNB: 580,
  };
  return Number(prices[String(symbol || "").toUpperCase()] || prices.BTC || 68000);
}

function upsertPortfolioHolding(userId, assetSymbol, assetName, amount, allocationPercent = 100) {
  const symbol = String(assetSymbol || "BTC").toUpperCase();
  const quantity = amount / Math.max(getAssetReferencePrice(symbol), 0.000001);
  const currentValue = amount;
  const existing = db.prepare(`SELECT * FROM portfolio_holdings WHERE user_id = ? AND asset_symbol = ?`).get(Number(userId), symbol);

  if (existing) {
    const newQuantity = Number(existing.quantity || 0) + quantity;
    const newCurrentValue = Number(existing.current_value || 0) + currentValue;
    const newAverageCost = (Number(existing.average_cost_basis || 0) * Number(existing.quantity || 0) + amount) / Math.max(newQuantity, 0.000001);
    const profitLoss = newCurrentValue - newAverageCost * newQuantity;

    db.prepare(`
      UPDATE portfolio_holdings
      SET quantity = ?, average_cost_basis = ?, current_value = ?, profit_loss = ?, allocation_percentage = ?, updated_at = datetime('now')
      WHERE user_id = ? AND asset_symbol = ?
    `).run(newQuantity, newAverageCost, newCurrentValue, profitLoss, allocationPercent, Number(userId), symbol);
    return db.prepare(`SELECT * FROM portfolio_holdings WHERE user_id = ? AND asset_symbol = ?`).get(Number(userId), symbol);
  }

  db.prepare(`
    INSERT INTO portfolio_holdings (user_id, asset_symbol, asset_name, quantity, average_cost_basis, current_value, profit_loss, allocation_percentage, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'USD', datetime('now'), datetime('now'))
  `).run(Number(userId), symbol, String(assetName || symbol), quantity, amount, currentValue, allocationPercent);

  return db.prepare(`SELECT * FROM portfolio_holdings WHERE user_id = ? AND asset_symbol = ?`).get(Number(userId), symbol);
}

function inferInvestmentPlanId(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return "starter";
  if (value >= 5000) return "income";
  if (value >= 2000) return "growth";
  return "starter";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/\s+/g, "").toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function isValidUsername(username) {
  const value = normalizeUsername(username);
  return /^[a-z0-9._-]{3,24}$/.test(value);
}

function isStrongPassword(password) {
  if (typeof password !== "string") return false;
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password)) return false;
  return true;
}

function getPasswordRequirements(password) {
  const requirements = [
    { key: "length", label: "8+ characters", ok: typeof password === "string" && password.length >= 8 },
    { key: "uppercase", label: "One uppercase letter", ok: /[A-Z]/.test(password || "") },
    { key: "lowercase", label: "One lowercase letter", ok: /[a-z]/.test(password || "") },
    { key: "number", label: "One number", ok: /\d/.test(password || "") },
    { key: "special", label: "One special character", ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password || "") },
  ];
  return requirements;
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function randomSixDigitOtp() {
  return String(crypto.randomInt(100000, 1000000)).padStart(6, "0");
}

function hashOtp(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function getExpiryDate(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function isEmailDeliveryConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function shouldAutoVerifyEmails() {
  return !isEmailDeliveryConfigured();
}

function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  return db.prepare(`SELECT * FROM users WHERE lower(email) = ?`).get(normalized) || null;
}

function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  return db.prepare(`SELECT * FROM users WHERE lower(username) = ?`).get(normalized) || null;
}

function getUserByIdentifier(identifier) {
  const normalized = normalizeEmail(identifier);
  const username = normalizeUsername(identifier);

  if (!normalized && !username) return null;
  const user = db.prepare(`SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ?`).get(normalized || "", username || "") || null;
  return user;
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

function ensureUserFinancialAccount(userId) {
  const normalizedId = Number(userId);
  const existing = db.prepare(`SELECT * FROM user_financial_accounts WHERE user_id = ?`).get(normalizedId);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO user_financial_accounts (user_id, available_balance, total_invested, total_returns, active_investments, total_deposits, total_withdrawals, currency, updated_at)
    VALUES (?, 0, 0, 0, 0, 0, 0, 'USD', datetime('now'))
  `).run(normalizedId);

  return db.prepare(`SELECT * FROM user_financial_accounts WHERE user_id = ?`).get(normalizedId);
}

function buildDashboardSummary(userId) {
  const normalizedId = Number(userId);
  const account = ensureUserFinancialAccount(normalizedId);
  const holdings = db.prepare(`SELECT * FROM portfolio_holdings WHERE user_id = ? ORDER BY updated_at DESC`).all(normalizedId);
  const investments = db.prepare(`SELECT * FROM investments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(normalizedId);
  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(normalizedId);
  const recentTransactions = db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(normalizedId);

  return {
    totals: {
      totalBalance: Number(account.available_balance || 0),
      totalInvested: Number(account.total_invested || 0),
      totalReturns: Number(account.total_returns || 0),
      activeInvestments: Number(account.active_investments || 0),
      currency: account.currency || 'USD',
    },
    holdings: holdings.map((item) => ({
      id: item.id,
      assetName: item.asset_name,
      assetSymbol: item.asset_symbol,
      quantity: Number(item.quantity || 0),
      averageCostBasis: Number(item.average_cost_basis || 0),
      currentValue: Number(item.current_value || 0),
      profitLoss: Number(item.profit_loss || 0),
      allocationPercentage: Number(item.allocation_percentage || 0),
      currency: item.currency || 'USD',
    })),
    investments: investments.map((item) => ({
      id: item.id,
      planId: item.plan_id,
      planName: item.plan_name,
      amount: Number(item.amount || 0),
      durationMonths: Number(item.duration_months || 0),
      expectedRoi: Number(item.expected_roi || 0),
      status: item.status,
      createdAt: item.created_at,
      maturityDate: item.maturity_date,
      paymentReference: item.payment_reference,
    })),
    notifications: notifications.map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      type: item.type,
      isRead: !!item.is_read,
      createdAt: item.created_at,
    })),
    transactions: recentTransactions.map((item) => ({
      id: item.id,
      type: item.type,
      amount: Number(item.amount || 0),
      currency: item.currency || 'USD',
      status: item.status,
      description: item.description,
      reference: item.reference,
      createdAt: item.created_at,
    })),
  };
}

function sendEmail({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!host || !smtpUser || !smtpPass) {
    const fallbackUrl = text.match(/https?:\/\/[^\s]+/)?.[0];
    console.warn(`EMAIL DELIVERY IS NOT CONFIGURED. To send real emails, set SMTP_HOST, SMTP_USER, SMTP_PASS, and APP_URL.`);
    if (fallbackUrl) {
      console.warn(`Verification fallback URL: ${fallbackUrl}`);
    }
    return Promise.resolve({ accepted: [to], simulated: true, messageId: null, emailConfigured: false });
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Boolean(process.env.SMTP_SECURE === "true"),
    auth: { user: smtpUser, pass: smtpPass },
  });

  return transporter.sendMail({ from: process.env.SMTP_FROM || smtpUser, to, subject, text, html }).then((info) => ({ ...info, emailConfigured: true }));
}

function buildUserResponse(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
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

  const emailResult = await sendEmail({
    to: user.email,
    subject: "Verify your Bitcoin Custody UK account",
    text,
    html: `<p>Hello ${user.name},</p><p>Please verify your email to activate your account.</p><p><a href="${verificationUrl}">Verify your account</a></p><p>This link expires at: ${new Date(expiresAt).toLocaleString()}</p>`,
  });

  db.prepare(`UPDATE users SET email_verification_sent_at = datetime('now') WHERE id = ?`).run(user.id);
  return {
    token,
    expiresAt,
    verificationUrl,
    emailSent: Boolean(isEmailDeliveryConfigured() && (emailResult?.accepted || emailResult?.messageId || emailResult?.response)),
    simulated: Boolean(!isEmailDeliveryConfigured() && emailResult?.simulated),
  };
}

function createPendingRegistration({ name, username, email, passwordHash }) {
  const otp = randomSixDigitOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000).toISOString();
  const existing = db.prepare(`SELECT * FROM pending_registrations WHERE lower(email) = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(normalizeEmail(email));
  if (existing) {
    db.prepare(`UPDATE pending_registrations SET status = 'expired', used_at = datetime('now') WHERE id = ?`).run(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO pending_registrations (name, username, email, password_hash, otp_hash, otp_expires_at, otp_attempts_used, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', datetime('now'))
  `).run(String(name).trim(), normalizeUsername(username), normalizeEmail(email), passwordHash, otpHash, expiresAt);

  const row = db.prepare(`SELECT * FROM pending_registrations WHERE id = ?`).get(result.lastInsertRowid);
  if (!isEmailDeliveryConfigured()) {
    console.warn(`OTP FOR ${row.email}: ${otp}`);
  }

  return { pendingRegistration: row, otp };
}

async function sendRegistrationOtpEmail(email, name, otp) {
  const expiresAt = Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000;
  const subject = "Verify your Bitcoin Custody UK account";
  const html = `
    <div style="font-family: Arial, sans-serif; background: #f4f7fb; padding: 32px 16px; color: #0f172a;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #dfe7f5;">
        <div style="background: linear-gradient(135deg, #0f172a, #12326d); color: white; padding: 24px 28px;">
          <div style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.9;">Bitcoin Custody UK</div>
          <h2 style="margin: 12px 0 0; font-size: 28px;">Verify your email address</h2>
        </div>
        <div style="padding: 24px 28px;">
          <p>Hello ${name},</p>
          <p>Use the six-digit verification code below to complete your registration.</p>
          <div style="margin: 28px 0; text-align: center; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 18px 12px;">
            <div style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #475569; margin-bottom: 8px;">Your code</div>
            <div style="font-size: 36px; letter-spacing: 10px; font-weight: 700; color: #0f172a;">${otp}</div>
          </div>
          <p>This code expires in ${OTP_EXPIRES_MINUTES} minutes.</p>
          <p style="color: #475569;">Security notice: never share this code with anyone.</p>
        </div>
      </div>
    </div>
  `;

  const text = `Bitcoin Custody UK account verification\n\nHello ${name},\nUse the verification code below to complete your registration:\n\n${otp}\n\nThis code expires in ${OTP_EXPIRES_MINUTES} minutes. Never share this code with anyone.`;
  const result = await sendEmail({
    to: email,
    subject,
    text,
    html,
  });

  return { emailSent: Boolean(isEmailDeliveryConfigured() && (result?.accepted || result?.messageId || result?.response)), expiresAt };
}

function createResetToken(userId) {
  const token = randomToken();
  const expiresAt = getExpiryDate(PASSWORD_RESET_TTL_HOURS / 24);
  db.prepare(`INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, datetime('now'))`).run(userId, token, expiresAt);
  return { token, expiresAt };
}

async function sendPasswordResetEmail(user) {
  const { token, expiresAt } = createResetToken(user.id);
  const link = `${APP_URL}/reset-password.html?token=${token}`;
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
    db.prepare(`INSERT INTO users (name, username, email, password_hash, email_verified, account_status, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, 1, 'active', 1, datetime('now'), datetime('now'))`).run("Bitcoin Custody UK Admin", "admin", ADMIN_EMAIL, passwordHash);
  }
}

upsertAdminUser();

app.get("/", (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "index.html")));
app.get(["/dashboard", "/dashboard.html"], (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "dashboard.html")));
app.get(["/profile", "/profile.html"], (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "profile.html")));
app.get(["/admin", "/admin.html"], authMiddleware, requireAdmin, (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "admin.html")));

app.get("/api/health", (req, res) => res.send("Bitcoin Custody UK backend is running"));
app.get(["/wallet", "/wallet.html"], (req, res) => res.sendFile(path.join(FRONTEND_ROOT, "wallet.html")));

app.get("/api/wallet/summary", authMiddleware, (req, res) => {
  const summary = buildDashboardSummary(req.user.id);
  const txs = db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`).all(req.user.id);
  const pendingWithdrawals = txs.filter((tx) => tx.type === "withdrawal" && tx.status === "pending");

  return res.json({
    user: buildUserResponse(req.user),
    account: {
      userId: req.user.id,
      availableBalance: Number(summary.totals.totalBalance || 0),
      totalDeposits: Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'completed'`).get(req.user.id)?.total || 0),
      totalWithdrawals: Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id = ? AND type = 'withdrawal'`).get(req.user.id)?.total || 0),
      currency: "USD",
    },
    totals: summary.totals,
    pendingWithdrawals: pendingWithdrawals.map((item) => ({
      id: item.id,
      amount: Number(item.amount || 0),
      status: item.status,
      reference: item.reference,
      description: item.description,
      createdAt: item.created_at,
    })),
    transactions: summary.transactions,
  });
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, username, email, password, confirmPassword } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedUsername = normalizeUsername(username);

    if (!name || !String(name).trim()) return res.status(400).json({ error: "Full name is required." });
    if (!normalizedUsername || !isValidUsername(normalizedUsername)) return res.status(400).json({ error: "Username must be 3-24 characters and contain only letters, numbers, dots, underscores, or hyphens." });
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) return res.status(400).json({ error: "A valid email address is required." });
    if (!password || !isStrongPassword(password)) return res.status(400).json({ error: "Password must include at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character." });
    if (confirmPassword !== undefined && password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });

    if (getUserByEmail(normalizedEmail) || db.prepare(`SELECT * FROM pending_registrations WHERE lower(email) = ? AND status = 'pending'`).get(normalizedEmail)) {
      createAuthEvent({ email: normalizedEmail, eventType: "registration", outcome: "failed", reason: "duplicate_email" });
      return res.status(409).json({ error: "An account with this email address already exists." });
    }

    const userExistsByUsername = getUserByUsername(normalizedUsername);
    const pendingUserExistsByUsername = db.prepare(`SELECT * FROM pending_registrations WHERE lower(username) = ? AND status = 'pending'`).get(normalizedUsername);
    if (userExistsByUsername || pendingUserExistsByUsername) {
      createAuthEvent({ email: normalizedEmail, eventType: "registration", outcome: "failed", reason: "duplicate_username" });
      return res.status(409).json({ error: "That username is already taken. Please choose another one." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pending = createPendingRegistration({ name: String(name).trim(), username: normalizedUsername, email: normalizedEmail, passwordHash });
    const emailResult = await sendRegistrationOtpEmail(normalizedEmail, String(name).trim(), pending.otp);

    createAuthEvent({ email: normalizedEmail, eventType: "registration_pending", outcome: "success", reason: "otp_sent" });

    return res.status(201).json({
      message: emailResult.emailSent
        ? "Registration received. Please verify your email with the six-digit code we sent you."
        : "Registration received. Your six-digit code was generated. Please complete verification in the next step.",
      email: normalizedEmail,
      username: pending.pendingRegistration.username,
      emailSent: emailResult.emailSent,
      verificationRequired: true,
    });
  } catch (err) {
    console.error("Error in /api/register:", err);
    return res.status(500).json({ error: "Unable to create your account right now." });
  }
});

app.post("/api/register/verify", async (req, res) => {
  const { email, code } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const otp = String(code || "").trim();

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: "Verification code must be six digits." });
  }

  const pending = db.prepare(`SELECT * FROM pending_registrations WHERE lower(email) = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(normalizedEmail);
  if (!pending) {
    return res.status(404).json({ error: "No pending registration was found for this email." });
  }

  if (new Date(pending.otp_expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE pending_registrations SET status = 'expired', used_at = datetime('now') WHERE id = ?`).run(pending.id);
    return res.status(410).json({ error: "This verification code has expired. Request a new one." });
  }

  const attemptsUsed = Number(pending.otp_attempts_used || 0);
  if (attemptsUsed >= OTP_MAX_ATTEMPTS) {
    db.prepare(`UPDATE pending_registrations SET status = 'expired', used_at = datetime('now') WHERE id = ?`).run(pending.id);
    return res.status(429).json({ error: "This verification code has been used too many times. Request a new one." });
  }

  if (hashOtp(otp) !== pending.otp_hash) {
    const nextAttempts = attemptsUsed + 1;
    db.prepare(`UPDATE pending_registrations SET otp_attempts_used = ?, otp_last_attempt_at = datetime('now') WHERE id = ?`).run(nextAttempts, pending.id);
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
    return res.status(400).json({ error: remaining > 0 ? `Invalid verification code. ${remaining} attempts remaining.` : "Verification code expired due to too many failed attempts." });
  }

  const existingUser = getUserByEmail(pending.email) || getUserByUsername(pending.username);
  if (existingUser) {
    db.prepare(`UPDATE pending_registrations SET status = 'used', used_at = datetime('now') WHERE id = ?`).run(pending.id);
    return res.status(409).json({ error: "This account is already registered." });
  }

  try {
    const insert = db.prepare(`
      INSERT INTO users (name, username, email, password_hash, email_verified, account_status, is_admin, created_at, email_verified_at, last_login_at)
      VALUES (?, ?, ?, ?, 1, 'active', 0, datetime('now'), datetime('now'), datetime('now'))
    `).run(pending.name, pending.username, pending.email, pending.password_hash);

    db.prepare(`UPDATE pending_registrations SET status = 'used', verified_at = datetime('now'), used_at = datetime('now') WHERE id = ?`).run(pending.id);

    const user = getUserById(insert.lastInsertRowid);
    createAuthEvent({ userId: user.id, email: user.email, eventType: "email_verification", outcome: "success", reason: "otp_verified" });

    const token = generateToken(user);
    return res.json({
      message: "Email verified successfully. Your account is now active.",
      token,
      user: buildUserResponse(user),
      redirectTo: "/dashboard.html",
    });
  } catch (error) {
    console.error("Error finalizing registration:", error);
    return res.status(500).json({ error: "Unable to complete registration right now." });
  }
});

app.post("/api/register/resend", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const pending = db.prepare(`SELECT * FROM pending_registrations WHERE lower(email) = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(email);
  if (!pending) {
    return res.status(404).json({ error: "There is no pending registration for this email." });
  }

  const lastAttempt = pending.otp_last_attempt_at ? new Date(pending.otp_last_attempt_at).getTime() : 0;
  if (Date.now() - lastAttempt < 60000) {
    return res.status(429).json({ error: "Please wait 60 seconds before requesting a new verification code." });
  }

  const otp = randomSixDigitOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000).toISOString();

  db.prepare(`UPDATE pending_registrations SET otp_hash = ?, otp_expires_at = ?, otp_attempts_used = 0, otp_last_attempt_at = datetime('now') WHERE id = ?`).run(otpHash, expiresAt, pending.id);

  if (!isEmailDeliveryConfigured()) {
    console.warn(`RESEND OTP FOR ${pending.email}: ${otp}`);
  }

  await sendRegistrationOtpEmail(pending.email, pending.name, otp);
  return res.json({ message: "A new verification code has been sent to your email." });
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
    const { identifier, password, email } = req.body || {};
    const userIdentifier = String(identifier || email || "").trim();

    if (!userIdentifier) return res.status(400).json({ error: "Username or email is required." });
    if (!password || !isStrongPassword(password)) return res.status(400).json({ error: "Password must include at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character." });

    const user = getUserByIdentifier(userIdentifier);
    if (!user) {
      createAuthEvent({ email: normalizeEmail(userIdentifier), eventType: "login", outcome: "failed", reason: "user_not_found" });
      return res.status(400).json({ error: "Invalid username/email or password." });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      db.prepare(`UPDATE users SET last_failed_login_at = datetime('now') WHERE id = ?`).run(user.id);
      createAuthEvent({ userId: user.id, email: user.email, eventType: "login", outcome: "failed", reason: "invalid_password" });
      return res.status(400).json({ error: "Invalid username/email or password." });
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

app.get("/api/dashboard/summary", authMiddleware, (req, res) => {
  const summary = buildDashboardSummary(req.user.id);
  return res.json({
    user: buildUserResponse(req.user),
    ...summary,
  });
});

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
  return res.json({ plans: getInvestmentPlans().map((plan) => ({ ...plan, roi: `${plan.roi}%` })) });
});

app.post("/api/invest", authMiddleware, (req, res) => {
  try {
    const { planId, amount, assetSymbol = "BTC", assetName = "Bitcoin", paymentReference } = req.body || {};
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "A valid investment amount is required." });
    }

    const selectedPlan = getInvestmentPlans().find((plan) => plan.id === (planId || inferInvestmentPlanId(parsedAmount))) || getInvestmentPlans()[0];
    if (parsedAmount < Number(selectedPlan.minimum || 0)) {
      return res.status(400).json({ error: `The minimum investment for ${selectedPlan.name} is $${Number(selectedPlan.minimum || 0).toLocaleString()}.` });
    }

    const userId = req.user.id;
    const reference = String(paymentReference || `INV-${Date.now()}-${userId}`).trim();
    const durationMonths = Number(selectedPlan.durationMonths || selectedPlan.duration?.match(/(\d+)/)?.[1] || 0);
    const expectedRoi = Number(selectedPlan.roi || 0);
    const maturityDate = new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000).toISOString();

    const investmentInsert = db.prepare(`
      INSERT INTO investments (user_id, plan_id, plan_name, amount, duration_months, expected_roi, status, created_at, maturity_date, payment_reference, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), ?, ?, ?)
    `);
    investmentInsert.run(userId, selectedPlan.id, selectedPlan.name, parsedAmount, durationMonths, expectedRoi, maturityDate, reference, JSON.stringify({ assetSymbol, assetName, source: "dashboard_purchase" }));

    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, status, reference, description, metadata, created_at)
      VALUES (?, 'investment', ?, 'USD', 'completed', ?, ?, ?, datetime('now'))
    `).run(userId, parsedAmount, reference, `Investment in ${selectedPlan.name}`, JSON.stringify({ assetSymbol, assetName, planId: selectedPlan.id }));

    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
      VALUES (?, 'Investment confirmed', ?, 'success', 0, datetime('now'))
    `).run(userId, `Your ${selectedPlan.name} investment of $${parsedAmount.toLocaleString()} has been recorded.`);

    const account = ensureUserFinancialAccount(userId);
    db.prepare(`
      UPDATE user_financial_accounts
      SET total_invested = total_invested + ?, active_investments = active_investments + 1, total_returns = total_returns + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(parsedAmount, parsedAmount * (expectedRoi / 100), userId);

    upsertPortfolioHolding(userId, assetSymbol, assetName, parsedAmount, 100);

    const summary = buildDashboardSummary(userId);
    return res.status(201).json({
      message: `Investment created successfully for ${selectedPlan.name}.`,
      investment: {
        id: db.prepare(`SELECT id FROM investments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(userId)?.id,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        amount: parsedAmount,
        status: "active",
        reference,
        maturityDate: maturityDate,
      },
      summary,
    });
  } catch (error) {
    console.error("Error creating investment:", error);
    return res.status(500).json({ error: "Unable to record the investment at this time." });
  }
});

app.post("/api/wallet/deposit", authMiddleware, (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid deposit amount is required." });

    const userId = req.user.id;
    const account = ensureUserFinancialAccount(userId);
    db.prepare(`
      UPDATE user_financial_accounts
      SET available_balance = available_balance + ?, total_deposits = total_deposits + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, userId);

    const reference = `DEP-${Date.now()}-${userId}`;
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, status, reference, description, metadata, created_at)
      VALUES (?, 'deposit', ?, 'USD', 'completed', ?, 'Wallet deposit', ?, datetime('now'))
    `).run(userId, amount, reference, JSON.stringify({ source: "wallet_deposit" }));

    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
      VALUES (?, 'Deposit received', ?, 'success', 0, datetime('now'))
    `).run(userId, `A deposit of $${amount.toLocaleString()} was recorded to your wallet.`);

    return res.status(201).json({ message: "Deposit recorded successfully.", account: buildDashboardSummary(userId).totals });
  } catch (error) {
    console.error("Error recording deposit:", error);
    return res.status(500).json({ error: "Unable to record the deposit right now." });
  }
});

app.post("/api/wallet/withdraw", authMiddleware, (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid withdrawal amount is required." });

    const userId = req.user.id;
    const account = ensureUserFinancialAccount(userId);
    if (amount > Number(account.available_balance || 0)) {
      return res.status(400).json({ error: "Withdrawal amount exceeds your available balance." });
    }

    db.prepare(`
      UPDATE user_financial_accounts
      SET available_balance = available_balance - ?, total_withdrawals = total_withdrawals + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, userId);

    const reference = `WTH-${Date.now()}-${userId}`;
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, status, reference, description, metadata, created_at)
      VALUES (?, 'withdrawal', ?, 'USD', 'pending', ?, 'Withdrawal request', ?, datetime('now'))
    `).run(userId, amount, reference, JSON.stringify({ source: "wallet_withdrawal" }));

    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
      VALUES (?, 'Withdrawal requested', ?, 'info', 0, datetime('now'))
    `).run(userId, `A withdrawal request of $${amount.toLocaleString()} has been submitted.`);

    return res.status(201).json({ message: "Withdrawal request created successfully.", account: buildDashboardSummary(userId).totals });
  } catch (error) {
    console.error("Error creating withdrawal request:", error);
    return res.status(500).json({ error: "Unable to create the withdrawal request right now." });
  }
});

app.get("/api/transactions", (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme === "Bearer" && token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = getUserById(payload.id);
        if (user && user.account_status === "active") {
          const txs = db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`).all(user.id);
          return res.json({ transactions: txs.map((tx) => ({
            id: tx.id,
            type: tx.type,
            amount: Number(tx.amount || 0),
            currency: tx.currency || "USD",
            status: tx.status,
            description: tx.description,
            reference: tx.reference,
            createdAt: tx.created_at,
          })) });
        }
      } catch (err) {
        // fall through to public feed
      }
    }

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
  const rows = db.prepare(`SELECT id, name, username, email, email_verified, account_status, created_at, last_login_at, is_admin FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return res.json({
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
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
  const users = db.prepare(`SELECT id, name, username, email, email_verified, account_status, created_at, last_login_at FROM users ORDER BY created_at DESC`).all();
  const events = db.prepare(`SELECT id, user_id, email, event_type, outcome, reason, metadata, created_at FROM auth_events ORDER BY created_at DESC`).all();

  if (type === "csv") {
    const rows = [["type", "id", "user_id", "name", "username", "email", "email_verified", "account_status", "created_at", "last_login_at", "event_type", "outcome", "reason", "metadata"]];
    users.forEach((user) => rows.push(["user", user.id, "", user.name, user.username || "", user.email, !!user.email_verified, user.account_status, user.created_at, user.last_login_at, "", "", "", ""]));
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  isEmailDeliveryConfigured,
  shouldAutoVerifyEmails,
  sendVerificationEmail,
};
