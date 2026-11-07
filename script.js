// Simple live crypto price loader using CoinGecko public API
// No API key needed for basic use

const API_BASE =
  (window.QuantumUtils && typeof window.QuantumUtils.resolveApiBase === "function"
    ? window.QuantumUtils.resolveApiBase(window.API_BASE)
    : window.API_BASE || "https://quantum-ledger-org.onrender.com");

async function loadPrices() {
  const tbody = document.getElementById("price-rows");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="4">Loading live prices...</td>
    </tr>
  `;

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,tether&order=market_cap_desc&per_page=3&page=1&sparkline=false"
    );

    if (!res.ok) {
      throw new Error("Network response was not ok");
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4">No data available.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = ""; // clear loading row

    data.forEach((coin) => {
      const tr = document.createElement("tr");

      const price = coin.current_price?.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });

      const change = coin.price_change_percentage_24h;
      const changeFormatted =
        change !== null && change !== undefined
          ? `${change.toFixed(2)}%`
          : "N/A";

      const volume = coin.total_volume?.toLocaleString("en-US");

      tr.innerHTML = `
        <td>${coin.name} (${coin.symbol.toUpperCase()})</td>
        <td>${price}</td>
        <td class="${
          change >= 0 ? "change-positive" : "change-negative"
        }">${changeFormatted}</td>
        <td>$${volume}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error("Error loading prices:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="4">Failed to load prices. Please refresh.</td>
      </tr>
    `;
  }
}

/**
 * Mobile navigation (hamburger)
 */
function setupMobileNav() {
  const navToggle = document.querySelector(".nav-toggle");
  const mobileNavLinks = document.querySelectorAll(".mobile-nav .nav-link");

  if (!navToggle) return;

  navToggle.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
  });

  // close menu when clicking a link
  mobileNavLinks.forEach((link) => {
    link.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
    });
  });
}

/**
 * Scroll reveal animations
 */
function setupScrollReveal() {
  const elements = document.querySelectorAll(
    ".section, .feature-card, .service-card, .price-table, .contact-form"
  );

  if (!("IntersectionObserver" in window)) {
    elements.forEach((el) => el.classList.add("visible"));
    return;
  }

  elements.forEach((el) => {
    el.classList.add("reveal-on-scroll");
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target); // animate only once
        }
      });
    },
    {
      threshold: 0.15,
    }
  );

  elements.forEach((el) => observer.observe(el));
}

/**
 * Smooth scrolling for internal anchor links
 */
function setupSmoothScroll() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      const targetId = href.slice(1);
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      e.preventDefault();
      targetEl.scrollIntoView({ behavior: "smooth" });
    });
  });
}

/**
 * Contact form submission feedback
 */
function setupContactForm() {
  const form = document.querySelector(".contact-form");
  if (!form) return;

  const successMsg = form.querySelector(".form-success");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = form.querySelector("#name");
    const email = form.querySelector("#email");
    const message = form.querySelector("#message");

    if (!name.value.trim() || !email.value.trim() || !message.value.trim()) {
      alert("Please fill in all fields before sending your message.");
      return;
    }

    if (successMsg) {
      successMsg.style.display = "block";
      successMsg.textContent =
        "Message sent successfully! We’ll get back to you soon.";
    }

    name.value = "";
    email.value = "";
    message.value = "";
  });
}

/**
 * Secure auth flow (register + login) for the landing page.
 * On success redirects to dashboard.html
 */
function setupAuthSystem() {
  const modalOverlay = document.getElementById("auth-modal");
  if (!modalOverlay) return;

  const openLoginButtons = document.querySelectorAll(".js-open-login");
  const openRegisterButtons = document.querySelectorAll(".js-open-register");
  const closeButton = modalOverlay.querySelector(".modal-close");
  const modalTitle = modalOverlay.querySelector("#modal-title");
  const modalSubtitle = modalOverlay.querySelector(".modal-subtitle");
  const registerExtra = modalOverlay.querySelector("#register-extra");
  const switchToRegister = modalOverlay.querySelector("#switch-to-register");
  const modalForm = modalOverlay.querySelector(".modal-form");

  const nameInput = modalOverlay.querySelector("#auth-name");
  const emailInput = modalOverlay.querySelector("#auth-email");
  const passwordInput = modalOverlay.querySelector("#auth-password");

  let mode = "login"; // "login" or "register"

  function getUsers() {
    try {
      const raw = localStorage.getItem("qlnUsers");
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Error reading users from localStorage", err);
      return [];
    }
  }

  function saveUsers(users) {
    try {
      localStorage.setItem("qlnUsers", JSON.stringify(users));
    } catch (err) {
      console.error("Error saving users to localStorage", err);
    }
  }

  function setCurrentUser(user) {
    try {
      localStorage.setItem("qlnCurrentUser", JSON.stringify(user));
    } catch (err) {
      console.error("Error saving current user", err);
    }
  }

  function setToken(token) {
    try {
      localStorage.setItem("qlnToken", token);
    } catch (err) {
      console.error("Error saving token", err);
    }
  }

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem("qlnCurrentUser");
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error("Error reading current user", err);
      return null;
    }
  }

  function redirectToDashboard() {
    window.location.href = "dashboard.html";
  }

  function openModal(nextMode = "login") {
    mode = nextMode;

    if (mode === "login") {
      modalTitle.textContent = "Login";
      modalSubtitle.textContent =
        "Access your Bitcoin Custody UK account to manage your digital assets.";
      if (registerExtra) registerExtra.style.display = "none";
    } else {
      modalTitle.textContent = "Register";
      modalSubtitle.textContent =
        "Create a secure account to start managing and tracking your crypto portfolio.";
      if (registerExtra) registerExtra.style.display = "block";
    }

    if (nameInput) nameInput.value = "";
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";

    modalOverlay.classList.add("open");
  }

  function closeModal() {
    modalOverlay.classList.remove("open");
  }

  function handleRegister() {
    const name = nameInput ? nameInput.value.trim() : "";
    const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
    const password = passwordInput ? passwordInput.value.trim() : "";

    if (!name || !email || !password) {
      alert("Please fill in name, email and password to register.");
      return;
    }

    const users = getUsers();
    if (users.some((u) => u.email === email)) {
      alert("An account with that email already exists. Try logging in.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          const msg = data?.error || "Registration failed. Please try again.";
          alert(msg);
          return;
        }

        closeModal();
        if (data?.verificationUrl) {
          const linkMessage = data.emailSent
            ? "Registration successful. Please check your email to verify your account before logging in."
            : `Registration successful. Use this verification link to activate your account: ${data.verificationUrl}`;

          alert(linkMessage);
          if (!data.emailSent) {
            window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
          }
        } else {
          alert(data?.message || "Registration successful. Please check your email to verify your account before logging in.");
        }
      } catch (err) {
        console.error("Error during register:", err);
        alert("Unable to register right now. Is the backend running?");
      }
    })();
  }

  function handleLogin() {
    const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
    const password = passwordInput ? passwordInput.value.trim() : "";

    if (!email || !password) {
      alert("Please enter email and password to login.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          const msg = data?.error || "Login failed. Please try again.";
          alert(msg);
          return;
        }

        setCurrentUser(data.user);
        setToken(data.token);
        closeModal();
        redirectToDashboard();
      } catch (err) {
        console.error("Error during login:", err);
        alert("Unable to log in right now. Is the backend running?");
      }
    })();
  }

  // Wire up open buttons
  openLoginButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openModal("login");
    });
  });

  openRegisterButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openModal("register");
    });
  });

  // Close actions
  if (closeButton) {
    closeButton.addEventListener("click", closeModal);
  }

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  if (switchToRegister) {
    switchToRegister.addEventListener("click", () => {
      openModal("register");
    });
  }

  // Handle form submit
  if (modalForm) {
    modalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (mode === "register") {
        handleRegister();
      } else {
        handleLogin();
      }
    });
  }

  // If user already logged in, you *could* auto-redirect:
  const existing = getCurrentUser();
  if (existing) {
    // redirectToDashboard(); // enable this if you want auto-redirect
  }
}

/**
 * Public social-proof feed for the landing page.
 */
function setupSocialProof() {
  if (!window.SocialProof || !document.getElementById("social-proof-toast-container")) {
    return;
  }

  const feed = new window.SocialProof({
    containerId: "social-proof-toast-container",
    fetchUrl: `${window.API_BASE || "http://localhost:4100"}/api/transactions?limit=8`,
    intervalMs: 10000,
  });

  feed.start();
}

function formatTickerCurrency(value, currency = "GBP") {
  if (!Number.isFinite(Number(value))) return "N/A";

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 100 ? 2 : 4,
    minimumFractionDigits: value >= 100 ? 2 : value >= 1 ? 2 : 4,
  });

  return formatter.format(Number(value));
}

function formatTickerChange(changeValue) {
  if (!Number.isFinite(Number(changeValue))) return "N/A";
  const sign = Number(changeValue) >= 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(Number(changeValue)).toFixed(2)}%`;
}

function buildTickerItem(item) {
  const direction = !Number.isFinite(Number(item.changePercent))
    ? "flat"
    : Number(item.changePercent) > 0
      ? "up"
      : Number(item.changePercent) < 0
        ? "down"
        : "flat";

  return `
    <a
      class="market-ticker-item"
      href="${item.url || "#"}"
      target="_blank"
      rel="noreferrer nofollow"
      aria-label="${item.label} ${item.priceText} ${item.changeText}"
    >
      <span class="market-ticker-label">${item.label}</span>
      <span class="market-ticker-price">${item.priceText}</span>
      <span class="market-ticker-change ${direction}">${item.changeText}</span>
    </a>
  `;
}

function buildDefaultTickerItems() {
  return [
    { key: "SPFUT", label: "S&P FUT", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/ES=F" },
    { key: "NQFUT", label: "NQ FUT", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/NQ=F" },
    { key: "DOWFUT", label: "DOW FUT", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/YM=F" },
    { key: "RUSSELL", label: "RUSSELL", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/%5ERTY" },
    { key: "BITCOIN", label: "BITCOIN", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/BTC-USD" },
    { key: "GOLD", label: "GOLD", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/GC=F" },
    { key: "SILVER", label: "SILVER", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/SI=F" },
    { key: "OIL", label: "CRUDE OIL", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/CL=F" },
    { key: "SP500", label: "S&P 500", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/%5EGSPC" },
    { key: "DOWJONES", label: "DOW JONES", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/%5EDJI" },
    { key: "NASDAQ", label: "NASDAQ", priceText: "N/A", changeText: "N/A", changePercent: Number.NaN, url: "https://finance.yahoo.com/quote/%5EIXIC" },
  ];
}

async function fetchCoinGeckoTicker() {
  try {
    const ids = ["bitcoin", "ethereum", "solana", "ripple"];
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=gbp&ids=${ids.join(",")}&price_change_percentage=24h&sparkline=false`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) return new Map();

    const data = await response.json();
    return new Map(
      data.map((coin) => [coin.id, {
        price: Number(coin.current_price),
        changePercent: Number(coin.price_change_percentage_24h),
      }])
    );
  } catch (error) {
    console.warn("CoinGecko ticker unavailable:", error);
    return new Map();
  }
}

async function fetchMarketTickerData() {
  const baseCandidates = Array.from(
    new Set(
      [window.API_BASE, API_BASE, "https://quantum-ledger-org.onrender.com", "https://bitcoin-custody-uk.onrender.com", "http://localhost:4100"].filter(Boolean)
    )
  );

  for (const base of baseCandidates) {
    try {
      const response = await fetch(`${base}/api/market`);
      if (!response.ok) continue;

      const payload = await response.json();
      const tickers = Array.isArray(payload?.tickers) ? payload.tickers : [];
      if (!tickers.length) continue;

      return new Map(
        tickers.map((item) => [item.key, {
          ...item,
          price: Number(item.price),
          changePercent: Number(item.changePercent),
        }])
      );
    } catch (error) {
      console.warn("Market ticker API unavailable:", error);
    }
  }

  return new Map();
}

async function fetchYahooTickerData(symbol) {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: {
        Accept: "application/json",
      },
    });

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
    console.warn(`Yahoo chart fetch failed for ${symbol}:`, error);
    return { price: Number.NaN, changePercent: Number.NaN };
  }
}

async function initMarketTicker() {
  const track = document.getElementById("market-ticker-track");
  const status = document.getElementById("market-ticker-status");
  if (!track || !status) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    status.textContent = "Bitcoin Custody UK";
  }

  try {
    const marketMap = await fetchMarketTickerData();
    const fallbackMap = await fetchCoinGeckoTicker();
    const tickerItems = [
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

    const directTickerMap = new Map();
    for (const item of tickerItems) {
      const quote = await fetchYahooTickerData(item.symbol);
      directTickerMap.set(item.key, quote);
    }

    const items = tickerItems.map((item) => {
      const data = marketMap.get(item.key) || directTickerMap.get(item.key) || fallbackMap.get(item.key.toLowerCase()) || {};
      const priceValue = Number(data.price);
      const changeValue = Number(data.changePercent);
      const priceText = Number.isFinite(priceValue)
        ? formatTickerCurrency(priceValue, "USD")
        : "N/A";

      return {
        ...item,
        priceText,
        changeText: Number.isFinite(changeValue) ? formatTickerChange(changeValue) : "N/A",
        changePercent: Number.isFinite(changeValue) ? changeValue : Number.NaN,
      };
    });

    const repeated = [...items, ...items];
    track.innerHTML = repeated.map(buildTickerItem).join("");
    status.textContent = "Bitcoin Custody UK";
  } catch (error) {
    console.error("Unable to load market ticker data:", error);
    track.innerHTML = [...buildDefaultTickerItems(), ...buildDefaultTickerItems()].map(buildTickerItem).join("");
    status.textContent = "Bitcoin Custody UK";
  }
}

/**
 * Initialize everything on page load
 */
function setupTrustedCarousel() {
  const carousel = document.querySelector(".hero-trust-carousel");
  if (!carousel) return;

  const track = carousel.querySelector(".trusted-carousel-track");
  const items = Array.from(track ? track.children : []);
  const nextBtn = carousel.querySelector(".hero-trust-arrow.next");
  const prevBtn = carousel.querySelector(".hero-trust-arrow.prev");

  if (!track || items.length === 0 || !nextBtn || !prevBtn) return;

  const itemWidth = items[0].getBoundingClientRect().width + 12;
  let position = 0;
  const maxStep = Math.max(0, items.length - Math.floor((carousel.clientWidth - 64) / itemWidth));

  function updateCarousel() {
    track.style.transform = `translateX(-${position * itemWidth}px)`;
  }

  nextBtn.addEventListener("click", () => {
    position = Math.min(position + 1, maxStep);
    updateCarousel();
  });

  prevBtn.addEventListener("click", () => {
    position = Math.max(position - 1, 0);
    updateCarousel();
  });

  window.addEventListener("resize", () => {
    const nextMaxStep = Math.max(0, items.length - Math.floor((carousel.clientWidth - 64) / itemWidth));
    position = Math.min(position, nextMaxStep);
    updateCarousel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      nextBtn.click();
    }
    if (event.key === "ArrowLeft") {
      prevBtn.click();
    }
  });

  updateCarousel();
}

document.addEventListener("DOMContentLoaded", () => {
  loadPrices();
  setupMobileNav();
  setupSmoothScroll();
  setupScrollReveal();
  setupContactForm();
  setupAuthSystem();
  setupSocialProof();
  initMarketTicker();
  setupTrustedCarousel();
});

