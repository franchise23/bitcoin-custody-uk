const API_BASE =
  window.API_BASE || "https://quantum-ledger-org.onrender.com";
const MARKET_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,tether,ripple,binancecoin&order=market_cap_desc&per_page=6&page=1&sparkline=false";

let cachedMarket = [];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatSignedCurrency(value) {
  const formatted = formatCurrency(value);
  return value >= 0 ? `+${formatted}` : `-${formatCurrency(Math.abs(value))}`;
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

async function fetchDashboardSummary() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}/api/dashboard/summary`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error("Error loading dashboard summary:", err);
    return null;
  }
}

async function loadMarketData() {
  try {
    const res = await fetch(MARKET_URL);
    if (!res.ok) throw new Error("Market request failed");

    const market = await res.json();
    cachedMarket = Array.isArray(market) ? market : [];
    return cachedMarket;
  } catch (err) {
    console.error("Error loading market data:", err);
    cachedMarket = [];
    return [];
  }
}

async function fetchPlans() {
  try {
    const res = await fetch(`${API_BASE}/api/investment-plans`);
    if (!res.ok) throw new Error("Plans request failed");
    const data = await res.json();
    return Array.isArray(data.plans) ? data.plans : [];
  } catch (err) {
    console.error("Unable to load investment plans:", err);
    return [];
  }
}

function updateLastUpdatedLabel() {
  const badge = document.getElementById("dash-last-updated");
  if (!badge) return;

  const now = new Date();
  const formatted = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  badge.textContent = `Updated ${formatted}`;
}

function renderSummaryCards(summary) {
  const totals = summary?.totals || {
    totalBalance: 0,
    totalInvested: 0,
    totalReturns: 0,
    activeInvestments: 0,
  };

  const ids = {
    totalBalance: "summary-total-balance",
    totalInvested: "summary-total-invested",
    totalReturns: "summary-total-returns",
    activeInvestments: "summary-active-investments",
  };

  document.getElementById(ids.totalBalance).textContent = formatCurrency(totals.totalBalance);
  document.getElementById(ids.totalInvested).textContent = formatCurrency(totals.totalInvested);
  document.getElementById(ids.totalReturns).textContent = formatCurrency(totals.totalReturns);
  document.getElementById(ids.activeInvestments).textContent = String(totals.activeInvestments || 0);

  document.getElementById("dash-total-balance").textContent = formatCurrency(totals.totalBalance);
  updateLastUpdatedLabel();
}

function renderPlans(plans) {
  const container = document.getElementById("investment-plans");
  if (!container) return;

  if (!plans.length) {
    container.innerHTML = '<p class="empty-state">Investment plans are currently unavailable.</p>';
    return;
  }

  container.innerHTML = plans
    .map(
      (plan) => `
        <div class="plan-item">
          <div class="plan-top-row">
            <div class="plan-name">${plan.name}</div>
            <div class="plan-roi">ROI ${plan.roi || "0%"}</div>
          </div>
          <p>${plan.description || "Professional portfolio allocation strategy."}</p>
          <div class="plan-meta">
            <span>Min: ${formatCurrency(plan.minimum || 0)}</span>
            <span>Duration: ${plan.duration || "N/A"}</span>
          </div>
          <div class="plan-meta" style="margin-top:.5rem;">
            <span>Risk: ${plan.risk || "Moderate"}</span>
            <span>Fee: ${plan.fee || "0%"}</span>
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:.8rem;" type="button" data-invest-plan="${plan.id}">Invest Now</button>
        </div>
      `
    )
    .join("");

  container.querySelectorAll('[data-invest-plan]').forEach((button) => {
    button.addEventListener("click", async () => {
      const planId = button.dataset.investPlan;
      const plan = plans.find((item) => item.id === planId);
      if (!plan) return;

      const minimum = Number(plan.minimum || 0);
      const proposed = Number.isFinite(minimum) && minimum > 0 ? String(minimum) : "500";
      const amountInput = window.prompt(`Enter your investment amount in USD for ${plan.name}. Minimum: ${formatCurrency(minimum)}.`, proposed);
      if (amountInput === null) return;

      const amount = Number(amountInput);
      if (!Number.isFinite(amount) || amount <= 0) {
        alert("Please enter a valid investment amount greater than zero.");
        return;
      }

      if (amount < minimum) {
        alert(`The minimum investment for ${plan.name} is ${formatCurrency(minimum)}.`);
        return;
      }

      await submitActionRequest({ action: "Buy", amount, asset: { name: "Bitcoin", symbol: "BTC" }, planId: plan.id });
    });
  });
}

async function submitActionRequest({ action, amount, asset, planId = null }) {
  const token = getToken();
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  const actions = {
    Buy: { endpoint: `${API_BASE}/api/invest`, payload: { planId: planId || "starter", amount, assetName: asset?.name || "Bitcoin", assetSymbol: asset?.symbol || "BTC" } },
    Deposit: { endpoint: `${API_BASE}/api/wallet/deposit`, payload: { amount } },
    Withdraw: { endpoint: `${API_BASE}/api/wallet/withdraw`, payload: { amount } },
  };

  const config = actions[action];
  if (!config) {
    alert(`The ${action} action is not available yet.`);
    return;
  }

  try {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config.payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Unable to complete ${action.toLowerCase()} request.`);
    }

    const summary = await fetchDashboardSummary();
    const user = await fetchCurrentUser();
    if (summary && user) {
      renderDashboard(user, summary, await loadMarketData());
      renderSummaryCards(summary);
    }

    alert(data.message || `${action} request submitted successfully.`);
    return data;
  } catch (error) {
    alert(error.message || "Request failed.");
    return null;
  }
}

function renderHoldings(holdings) {
  const container = document.getElementById("dash-asset-grid");
  if (!container) return;

  if (!holdings.length) {
    container.innerHTML = `
      <div class="empty-state-card">
        <h4>No holdings yet</h4>
        <p>Your portfolio will appear here after a verified acquisition or allocation.</p>
      </div>
    `;
    return;
  }

  const colorMap = {
    BTC: "#f7931a",
    ETH: "#6b7280",
    USDT: "#22c55e",
    SOL: "#14b8a6",
    XRP: "#5b9cff",
    BNB: "#f3ba2f",
  };

  container.innerHTML = holdings
    .map((holding) => {
      const symbol = String(holding.assetSymbol || "").toUpperCase();
      const color = colorMap[symbol] || "#0ea5e9";
      const allocation = Number(holding.allocationPercentage || 0);
      const pnl = Number(holding.profitLoss || 0);
      return `
        <div class="dash-asset-card">
          <div class="dash-asset-top">
            <div class="dash-asset-name">
              <div class="dash-asset-icon" style="background:${color}">${symbol.slice(0, 3)}</div>
              <div>
                <div>${holding.assetName || symbol}</div>
                <div class="dash-asset-amount">${Number(holding.quantity || 0).toFixed(4)} ${symbol}</div>
              </div>
            </div>
            <div class="dash-asset-price">${formatCurrency(holding.currentValue || 0)}</div>
          </div>
          <div class="dash-asset-row">
            <div class="dash-asset-value">Avg cost: ${formatCurrency(holding.averageCostBasis || 0)}</div>
            <div class="dash-asset-change ${pnl >= 0 ? "pos" : "neg"}">${formatSignedCurrency(pnl)}</div>
          </div>
          <div class="dash-asset-row">
            <div class="dash-asset-value">Allocation: ${allocation.toFixed(1)}%</div>
            <div class="dash-asset-value">${holding.currency || "USD"}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderInvestments(investments) {
  const container = document.getElementById("dashboard-investments");
  if (!container) return;

  if (!investments.length) {
    container.innerHTML = '<p class="empty-state">No active investment positions have been recorded yet.</p>';
    return;
  }

  container.innerHTML = investments
    .map((investment) => `
      <div class="plan-item">
        <div class="plan-top-row">
          <div class="plan-name">${investment.planName || "Investment"}</div>
          <div class="plan-risk">${investment.status || "Pending"}</div>
        </div>
        <div class="plan-meta">
          <span>Amount: ${formatCurrency(investment.amount || 0)}</span>
          <span>ROI: ${Number(investment.expectedRoi || 0)}%</span>
        </div>
        <div class="plan-meta" style="margin-top:.5rem;">
          <span>Duration: ${Number(investment.durationMonths || 0)} months</span>
          <span>Ref: ${investment.paymentReference || "—"}</span>
        </div>
      </div>
    `)
    .join("");
}

function renderNotifications(notifications) {
  const container = document.getElementById("dashboard-notifications");
  if (!container) return;

  if (!notifications.length) {
    container.innerHTML = '<p class="empty-state">No account notifications yet.</p>';
    return;
  }

  container.innerHTML = notifications
    .slice(0, 5)
    .map(
      (notification) => `
        <div class="notification-item ${notification.isRead ? "is-read" : ""}">
          <div class="notification-title">${notification.title}</div>
          <div class="notification-message">${notification.message}</div>
          <div class="notification-meta">${new Date(notification.createdAt).toLocaleString()}</div>
        </div>
      `
    )
    .join("");
}

function renderTransactions(transactions) {
  const container = document.getElementById("dashboard-transactions");
  if (!container) return;

  if (!transactions.length) {
    container.innerHTML = '<p class="empty-state">No transactions have been recorded for this account.</p>';
    return;
  }

  container.innerHTML = transactions
    .slice(0, 8)
    .map(
      (tx) => `
        <div class="transaction-row">
          <div>
            <div class="transaction-type">${tx.type || "Transaction"}</div>
            <div class="transaction-meta">${new Date(tx.createdAt).toLocaleString()}</div>
          </div>
          <div class="transaction-status ${tx.status || "pending"}">${tx.status || "Pending"}</div>
          <div class="transaction-amount">${formatCurrency(tx.amount || 0)}</div>
        </div>
      `
    )
    .join("");
}

function drawPortfolioChart() {
  const canvas = document.getElementById("portfolioChart");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(14, 165, 233, 0.35)");
  gradient.addColorStop(1, "rgba(14, 165, 233, 0.02)");

  context.fillStyle = "#f8fbff";
  context.fillRect(0, 0, width, height);

  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];
  const values = [0, 1800, 2400, 2100, 4200, 3900, 4500];

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1000);

  context.beginPath();
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * (width - 40) + 20;
    const y = height - ((value - min) / (max - min || 1)) * (height - 50) - 15;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = "#0ea5e9";
  context.lineWidth = 3;
  context.stroke();

  context.lineTo(width - 20, height - 15);
  context.lineTo(20, height - 15);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  labels.forEach((label, index) => {
    const x = (index / (labels.length - 1)) * (width - 40) + 20;
    context.fillStyle = "#64748b";
    context.font = "12px Poppins";
    context.fillText(label, x - 8, height - 5);
  });
}

function renderDashboard(user, summary, marketData) {
  const name = user?.name || user?.username || user?.email || "Investor";
  const firstName = String(name).split(" ")[0];
  const welcome = document.getElementById("dash-welcome-message");
  if (welcome) {
    welcome.textContent = `Welcome back, ${firstName}`;
  }

  const usernameEl = document.getElementById("dash-username");
  if (usernameEl) {
    usernameEl.textContent = firstName;
  }

  const totals = summary?.totals || { totalBalance: 0, totalInvested: 0, totalReturns: 0, activeInvestments: 0 };
  document.getElementById("dash-total-balance").textContent = formatCurrency(totals.totalBalance);
  document.getElementById("summary-total-balance").textContent = formatCurrency(totals.totalBalance);
  document.getElementById("summary-total-invested").textContent = formatCurrency(totals.totalInvested);
  document.getElementById("summary-total-returns").textContent = formatCurrency(totals.totalReturns);
  document.getElementById("summary-active-investments").textContent = String(totals.activeInvestments || 0);

  renderHoldings(summary?.holdings || []);
  renderInvestments(summary?.investments || []);
  renderNotifications(summary?.notifications || []);
  renderTransactions(summary?.transactions || []);
  drawPortfolioChart();

  if (Array.isArray(marketData) && marketData.length) {
    const marketHtml = marketData
      .slice(0, 6)
      .map((coin) => {
        const change = Number(coin.price_change_percentage_24h || 0);
        const changeClass = change >= 0 ? "pos" : "neg";
        return `
          <div class="market-row">
            <div class="market-coin">
              <span class="market-symbol">${String(coin.symbol || "").toUpperCase()}</span>
              <span class="market-name">${coin.name || "Asset"}</span>
            </div>
            <span class="market-price">${formatCurrency(coin.current_price || 0)}</span>
            <span class="market-change ${changeClass}">${change.toFixed(2)}%</span>
          </div>
        `;
      })
      .join("");

    const target = document.getElementById("dash-asset-grid");
    if (target && !summary?.holdings?.length) {
      target.innerHTML = marketHtml;
    }
  }
}

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

  updateLastUpdatedLabel();
  window.setInterval(updateLastUpdatedLabel, 1000);

  const marketData = await loadMarketData();
  const summary = await fetchDashboardSummary();
  const plans = await fetchPlans();
  renderPlans(plans);
  renderDashboard(user, summary || { totals: { totalBalance: 0, totalInvested: 0, totalReturns: 0, activeInvestments: 0 }, holdings: [], investments: [], notifications: [], transactions: [] }, marketData);
  renderSummaryCards(summary || { totals: { totalBalance: 0, totalInvested: 0, totalReturns: 0, activeInvestments: 0 } });
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
      modalList.innerHTML = "<p style='padding:1rem;'>No assets loaded yet. Try again in a moment.</p>";
      return;
    }

    data.forEach((coin) => {
      const row = document.createElement("button");
      row.className = "dash-action-asset";
      row.type = "button";
      row.innerHTML = `
        <div>
          <div class="dash-action-asset-name">${coin.name}</div>
          <div class="dash-action-asset-symbol">${String(coin.symbol || "").toUpperCase()}</div>
        </div>
        <div class="dash-action-asset-price">${formatCurrency(coin.current_price || 0)}</div>
      `;
      row.addEventListener("click", () => {
        selectedAsset = coin;
        modalList.querySelectorAll(".dash-action-asset").forEach((asset) => asset.classList.remove("selected"));
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
    confirmBtn.addEventListener("click", async () => {
      if (!selectedAsset) {
        alert("Select an asset first.");
        return;
      }
      const amount = parseFloat(amountInput.value || "0");
      if (!amount || amount <= 0) {
        alert("Enter an amount greater than zero.");
        return;
      }

      const action = currentAction || "Buy";
      const result = await submitActionRequest({
        action,
        amount,
        asset: { name: selectedAsset.name, symbol: selectedAsset.symbol },
        planId: null,
      });

      if (result) {
        closeModal();
      }
    });
  }

  document.addEventListener("keyup", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

