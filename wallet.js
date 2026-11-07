const API_BASE =
  (window.QuantumUtils && typeof window.QuantumUtils.resolveApiBase === "function"
    ? window.QuantumUtils.resolveApiBase(window.API_BASE)
    : window.API_BASE || "https://bitcoin-custody-uk.onrender.com");

function getToken() {
  try {
    return localStorage.getItem("qlnToken");
  } catch (err) {
    console.error("Error reading token", err);
    return null;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function clearAuthData() {
  localStorage.removeItem("qlnToken");
  localStorage.removeItem("qlnCurrentUser");
}

async function fetchWalletSummary() {
  const token = getToken();
  if (!token) {
    window.location.href = "index.html";
    return null;
  }

  const res = await fetch(`${API_BASE}/api/wallet/summary`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Unable to load wallet data.");
  }

  return res.json();
}

function renderSummary(summary) {
  const account = summary?.account || {};
  const totals = summary?.totals || {
    totalBalance: 0,
    totalInvested: 0,
    totalReturns: 0,
    activeInvestments: 0,
  };

  const data = {
    availableBalance: account.availableBalance ?? totals.totalBalance ?? 0,
    totalDeposits: account.totalDeposits ?? 0,
    totalWithdrawals: account.totalWithdrawals ?? 0,
    pendingCount: Array.isArray(summary?.pendingWithdrawals) ? summary.pendingWithdrawals.length : 0,
  };

  document.getElementById("wallet-available-balance").textContent = formatCurrency(data.availableBalance);
  document.getElementById("wallet-total-deposits").textContent = formatCurrency(data.totalDeposits);
  document.getElementById("wallet-total-withdrawals").textContent = formatCurrency(data.totalWithdrawals);
  document.getElementById("wallet-pending-count").textContent = String(data.pendingCount);
}

function renderTransactions(transactions) {
  const container = document.getElementById("wallet-transactions");
  if (!container) return;

  if (!Array.isArray(transactions) || !transactions.length) {
    container.innerHTML = '<p class="empty-state">No wallet transactions have been recorded yet.</p>';
    return;
  }

  container.innerHTML = transactions
    .slice(0, 12)
    .map((tx) => `
      <div class="transaction-row">
        <div>
          <div class="transaction-type">${tx.description || tx.type || "Transaction"}</div>
          <div class="transaction-meta">${new Date(tx.createdAt).toLocaleString()}</div>
        </div>
        <div class="transaction-status ${tx.status || "pending"}">${tx.status || "Pending"}</div>
        <div class="transaction-amount">${formatCurrency(tx.amount || 0)}</div>
      </div>
    `)
    .join("");
}

async function submitWalletAction(type) {
  const token = getToken();
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  const amountInput = document.getElementById("wallet-amount");
  const amount = Number(amountInput?.value || "0");

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a valid amount greater than zero.");
    return;
  }

  const endpoint = type === "deposit" ? `${API_BASE}/api/wallet/deposit` : `${API_BASE}/api/wallet/withdraw`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Request failed.");
    }

    alert(data.message || `${type} request submitted.`);
    if (amountInput) amountInput.value = "";

    const summary = await fetchWalletSummary();
    renderSummary(summary);
    renderTransactions(summary?.transactions || []);
  } catch (error) {
    alert(error.message || "Unable to process the wallet action.");
  }
}

function setupLogout() {
  const btn = document.getElementById("wallet-logout");
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

  try {
    const summary = await fetchWalletSummary();
    renderSummary(summary || { account: {}, totals: {}, pendingWithdrawals: [] });
    renderTransactions(summary?.transactions || []);
  } catch (error) {
    console.error("Wallet load error:", error);
    alert(error.message || "Unable to load your wallet right now.");
  }

  document.getElementById("wallet-deposit-btn")?.addEventListener("click", () => submitWalletAction("deposit"));
  document.getElementById("wallet-withdraw-btn")?.addEventListener("click", () => submitWalletAction("withdraw"));
  setupLogout();
});
