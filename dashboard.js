const API_BASE =
  window.API_BASE ||
  "https://quantum-ledger-org.onrender.com"; // backend base URL (prod); override by setting window.API_BASE before script loads
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false";

// Your demo portfolio (amounts you hold)
const DEMO_HOLDINGS = [
  { id: "bitcoin", symbol: "BTC", label: "Bitcoin (BTC)", amount: 0.35 },
  { id: "ethereum", symbol: "ETH", label: "Ethereum (ETH)", amount: 4.8 },
  { id: "tether", symbol: "USDT", label: "Tether (USDT)", amount: 3000 },
  { id: "solana", symbol: "SOL", label: "Solana (SOL)", amount: 45 },
];

let cachedMarket = [];

function formatCurrency(value) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getToken() {
  try {
    return localStorage.getItem("qlnToken");
  } catch (err) {
    console.error("Error reading token", err);
    return null;
  }
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem("qlnCurrentUser");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Error reading stored user", err);
    return null;
  }
}

function clearAuthData() {
  localStorage.removeItem("qlnToken");
  localStorage.removeItem("qlnCurrentUser");
}

// Call backend to verify token and get current user
async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}/api/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data.user || null;
  } catch (err) {
    console.error("Error calling /api/me:", err);
    return null;
  }
}

// Get live market data from CoinGecko and merge with DEMO_HOLDINGS
async function loadPortfolioData() {
  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) {
      throw new Error("Failed to fetch market data");
    }

    const marketData = await res.json(); // array of coins
    const byId = {};
    marketData.forEach((coin) => {
      byId[coin.id] = coin;
    });

    let totalValue = 0;
    let topAsset = null;

    const enrichedHoldings = DEMO_HOLDINGS.map((h) => {
      const coin = byId[h.id];
      let price = 0;
      let change24h = 0;

      if (coin) {
        price = coin.current_price || 0;
        change24h = coin.price_change_percentage_24h || 0;
      }

      const value = price * h.amount;
      totalValue += value;

      const enriched = {
        ...h,
        price,
        value,
        change24h,
      };

      if (!topAsset || value > topAsset.value) {
        topAsset = enriched;
      }

      return enriched;
    });

    return {
      holdings: enrichedHoldings,
      totalValue,
      topAsset,
      lastUpdated: new Date(),
      market: marketData,
    };
  } catch (err) {
    console.error("Error loading portfolio data:", err);

    // Fallback: static approximations if API fails
    const fallbackHoldings = [
      { ...DEMO_HOLDINGS[0], price: 26000, value: 26000 * DEMO_HOLDINGS[0].amount, change24h: 3.2 },
      { ...DEMO_HOLDINGS[1], price: 1800, value: 1800 * DEMO_HOLDINGS[1].amount, change24h: 1.4 },
      { ...DEMO_HOLDINGS[2], price: 1, value: DEMO_HOLDINGS[2].amount * 1, change24h: 0.0 },
      { ...DEMO_HOLDINGS[3], price: 150, value: 150 * DEMO_HOLDINGS[3].amount, change24h: 5.1 },
    ];

    let totalValue = 0;
    let topAsset = fallbackHoldings[0];

    fallbackHoldings.forEach((h) => {
      totalValue += h.value;
      if (!topAsset || h.value > topAsset.value) {
        topAsset = h;
      }
    });

    return {
      holdings: fallbackHoldings,
      totalValue,
      topAsset,
      lastUpdated: new Date(),
      market: [],
    };
  }
}

// Fill in dashboard UI with user + portfolio data
function populateDashboard(user, portfolio) {
  const nameEl = document.getElementById("dash-username");
  const totalBalanceEl = document.getElementById("dash-total-balance");
  const holdingsGrid = document.getElementById("dash-asset-grid");
  const lastUpdatedEl = document.getElementById("dash-last-updated");

  if (nameEl) {
    nameEl.textContent = user.name || user.email;
  }

  if (lastUpdatedEl && portfolio.lastUpdated) {
    const t = portfolio.lastUpdated;
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const ss = String(t.getSeconds()).padStart(2, "0");
    lastUpdatedEl.textContent = `Last updated: ${hh}:${mm}:${ss}`;
  }

  if (totalBalanceEl) {
    totalBalanceEl.textContent = formatCurrency(portfolio.totalValue || 0);
  }

  cachedMarket = portfolio.market || [];

  if (holdingsGrid) {
    holdingsGrid.innerHTML = "";
    const holdingsMap = {};
    portfolio.holdings.forEach((h) => {
      holdingsMap[h.id] = h;
    });

    const colorMap = {
      BTC: "#f7931a",
      ETH: "#6b7280",
      USDT: "#22c55e",
      SOL: "#14b8a6",
    };

    const dataToRender = cachedMarket.length ? cachedMarket : portfolio.holdings;

    dataToRender.forEach((coin) => {
      const symbol = coin.symbol?.toUpperCase() || "";
      const bg = colorMap[symbol] || "#0ea5e9";
      const holding = holdingsMap[coin.id];
      const amount = holding ? holding.amount : 0;
      const price = coin.current_price || holding?.price || 0;
      const value = price * amount;
      const change = coin.price_change_percentage_24h || holding?.change24h || 0;
      const changeClass = change >= 0 ? "pos" : "neg";
      const changeLabel =
        change || change === 0 ? `${change.toFixed(2)}%` : "N/A";

      const card = document.createElement("div");
      card.className = "dash-asset-card";

      card.innerHTML = `
        <div class="dash-asset-top">
          <div class="dash-asset-name">
            <div class="dash-asset-icon" style="background:${bg}">${symbol.slice(
              0,
              3
            )}</div>
            <div>
              <div>${coin.name || holding?.label || symbol}</div>
              <div class="dash-asset-value">${amount.toFixed(8)} ${symbol}</div>
            </div>
          </div>
          <div class="dash-asset-price">${formatCurrency(price)}</div>
        </div>
        <div class="dash-asset-row">
          <div class="dash-asset-value">=${formatCurrency(value || 0)}</div>
          <div class="dash-asset-change ${changeClass}">${changeLabel}</div>
        </div>
      `;

      holdingsGrid.appendChild(card);
    });
  }
}

// Logout handler
function setupLogout() {
  const btn = document.getElementById("dash-logout");
  if (!btn) return;

  btn.addEventListener("click", () => {
    clearAuthData();
    window.location.href = "index.html";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const token = getToken();
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  // 1. Validate user with backend
  let user = await fetchCurrentUser();

  if (!user) {
    const storedUser = getStoredUser();
    if (storedUser) {
      user = storedUser;
    } else {
      clearAuthData();
      window.location.href = "index.html";
      return;
    }
  }

  // 2. Load live portfolio data
  const portfolio = await loadPortfolioData();

  // 3. Populate UI
  populateDashboard(user, portfolio);
  setupLogout();
  setupActionModals();
});

function setupActionModals() {
  const modal = document.getElementById("dash-action-modal");
  const modalTitle = document.getElementById("dash-action-title");
  const modalList = document.getElementById("dash-action-list");
  const modalClose = document.querySelector(".dash-action-close");
  const overlay = document.querySelector(".dash-action-overlay");
  const amountInput = document.getElementById("dash-action-amount");
  const confirmBtn = document.getElementById("dash-action-confirm");

  const actionButtons = document.querySelectorAll("[data-action]");
  if (!modal || !modalTitle || !modalList || !actionButtons.length) return;

  let currentAction = null;
  let selectedAsset = null;

  function openModal(action) {
    currentAction = action;
    selectedAsset = null;
    modalTitle.textContent = `Select Asset to ${action}`;
    amountInput.value = "";
    renderList();
    modal.classList.add("open");
    if (overlay) overlay.classList.add("open");
  }

  function closeModal() {
    modal.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
  }

  function renderList() {
    modalList.innerHTML = "";
    const data = cachedMarket.length ? cachedMarket : [];
    if (!data.length) {
      modalList.innerHTML =
        "<p style=\"padding:1rem;\">No assets loaded yet. Try again in a moment.</p>";
      return;
    }
    data.forEach((coin) => {
      const row = document.createElement("button");
      row.className = "dash-action-asset";
      row.type = "button";
      row.innerHTML = `
        <div>
          <div class="dash-action-asset-name">${coin.name}</div>
          <div class="dash-action-asset-symbol">${coin.symbol.toUpperCase()}</div>
        </div>
        <div class="dash-action-asset-price">${formatCurrency(
          coin.current_price || 0
        )}</div>
      `;
      row.addEventListener("click", () => {
        selectedAsset = coin;
        const rows = modalList.querySelectorAll(".dash-action-asset");
        rows.forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
      });
      modalList.appendChild(row);
    });
  }

  actionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      openModal(btn.dataset.action);
    });
  });

  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (overlay) overlay.addEventListener("click", closeModal);

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (!selectedAsset) {
        alert("Select an asset first.");
        return;
      }
      const amt = parseFloat(amountInput.value || "0");
      if (!amt || amt <= 0) {
        alert("Enter an amount greater than zero.");
        return;
      }
      alert(
        `Demo ${currentAction} request for ${amt} ${selectedAsset.symbol.toUpperCase()} submitted.`
      );
      closeModal();
    });
  }

  document.addEventListener("keyup", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

