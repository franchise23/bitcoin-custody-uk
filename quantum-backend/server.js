require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

// Config
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_fallback_secret";
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://franchise23.github.io",
  "https://franchise23.github.io/quantum-ledger-clone",
  "https://bitcoin-custody-uk.onrender.com",
  "https://quantum-ledger-org.onrender.com",
];

// Allow your frontend origins
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl/postman
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: false,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

function ensureUserStore() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
}

function loadUsers() {
  ensureUserStore();

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error reading users file:", err);
    return [];
  }
}

function saveUsers(users) {
  ensureUserStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let users = loadUsers();
let nextUserId =
  users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0) + 1;

// Helper: generate JWT
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

// Helper: auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [type, token] = authHeader.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(TRANSACTIONS_FILE)) {
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify([], null, 2));
  }
}

function loadUsers() {
  ensureDataFiles();

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error reading users file:", err);
    return [];
  }
}

function saveUsers(users) {
  ensureDataFiles();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const SAMPLE_COMPLETED_TRANSACTIONS = [
  {
    id: "tx-1001",
    investorName: "Alicia M.",
    planName: "Growth Plus",
    amount: 2400,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
  {
    id: "tx-1002",
    investorName: "Daniel C.",
    planName: "Starter Capital",
    amount: 1500,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: "tx-1003",
    investorName: "Renee T.",
    planName: "Income Max",
    amount: 6400,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  },
  {
    id: "tx-1004",
    investorName: "Samuel K.",
    planName: "Growth Plus",
    amount: 3200,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 27 * 60 * 1000).toISOString(),
  },
  {
    id: "tx-1005",
    investorName: "Priya N.",
    planName: "Starter Capital",
    amount: 950,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 41 * 60 * 1000).toISOString(),
  },
  {
    id: "tx-1006",
    investorName: "Marcus H.",
    planName: "Income Max",
    amount: 8700,
    status: "completed",
    isPublic: true,
    completedAt: new Date(Date.now() - 58 * 60 * 1000).toISOString(),
  },
];

function loadTransactions() {
  ensureDataFiles();

  try {
    const raw = fs.readFileSync(TRANSACTIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }

    fs.writeFileSync(
      TRANSACTIONS_FILE,
      JSON.stringify(SAMPLE_COMPLETED_TRANSACTIONS, null, 2)
    );
    return SAMPLE_COMPLETED_TRANSACTIONS;
  } catch (err) {
    console.error("Error reading transaction file:", err);
    return SAMPLE_COMPLETED_TRANSACTIONS;
  }
}

function saveTransactions(transactions) {
  ensureDataFiles();
  fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
}

// ROUTES

// Health check
app.get("/", (req, res) => {
  res.send("Bitcoin Custody UK backend is running");
});

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required" });
    }

    const normalizedEmail = String(email).toLowerCase();
    const existing = users.find((u) => u.email === normalizedEmail);
    if (existing) {
      return res
        .status(400)
        .json({ error: "User with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: nextUserId++,
      name,
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);

    const token = generateToken(newUser);

    return res.json({
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (err) {
    console.error("Error in /api/register:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required" });
    }

    const normalizedEmail = String(email).toLowerCase();
    const user = users.find((u) => u.email === normalizedEmail);

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = generateToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Error in /api/login:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user
app.get("/api/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

// Investment plans that can be shown in the dashboard
app.get("/api/investment-plans", (req, res) => {
  const plans = [
    {
      id: "starter", 
      name: "Starter Capital",
      roi: "12%",
      minimum: 500,
      duration: "6 months",
      description: "A balanced growth plan for first-time investors.",
      risk: "Moderate"
    },
    {
      id: "growth",
      name: "Growth Plus",
      roi: "18%",
      minimum: 2000,
      duration: "12 months",
      description: "Higher return potential with a diversified portfolio.",
      risk: "Balanced"
    },
    {
      id: "income",
      name: "Income Max",
      roi: "24%",
      minimum: 5000,
      duration: "18 months",
      description: "Optimized for income-focused investors seeking longer-term yield.",
      risk: "Premium"
    }
  ];

  return res.json({ plans });
});

// Recent completed public investment transactions for the social-proof widget.
app.get("/api/transactions", (req, res) => {
  try {
    const transactions = loadTransactions()
      .filter((tx) => tx && tx.status === "completed" && tx.isPublic !== false)
      .sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0))
      .slice(0, Number(req.query.limit) || 10);

    return res.json({ transactions });
  } catch (err) {
    console.error("Error loading transactions:", err);
    return res.status(500).json({ error: "Unable to load transactions" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
