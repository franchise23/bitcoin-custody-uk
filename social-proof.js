(function () {
  const DEFAULT_INTERVAL = 8000;

  function formatCurrency(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function maskName(name) {
    const clean = String(name || "Investor").trim();
    if (!clean) return "Investor";

    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return `${parts[0].charAt(0).toUpperCase()}***`;
    }

    const first = parts[0].charAt(0).toUpperCase();
    const last = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${first}***${last}`;
  }

  function formatTimeAgo(dateValue) {
    const date = new Date(dateValue || Date.now());
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hr ago`;
    }

    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }

  class SocialProof {
    constructor(options = {}) {
      this.containerId = options.containerId || "social-proof-toast-container";
      this.fetchUrl =
        options.fetchUrl ||
        `${window.API_BASE || "http://localhost:4000"}/api/transactions?limit=8`;
      this.intervalMs = Number(options.intervalMs || window.SOCIAL_PROOF_INTERVAL_MS || DEFAULT_INTERVAL);
      this.container = document.getElementById(this.containerId);
      this.queue = [];
      this.currentIndex = 0;
      this.timer = null;
    }

    renderLoadingState() {
      if (!this.container) return;
      this.container.innerHTML = '<div class="social-proof-status">Loading recent activity…</div>';
    }

    renderEmptyState() {
      if (!this.container) return;
      this.container.innerHTML = '<div class="social-proof-status">No completed investment activity yet.</div>';
    }

    renderErrorState() {
      if (!this.container) return;
      this.container.innerHTML = '<div class="social-proof-status">Unable to load recent investment activity.</div>';
    }

    async loadTransactions() {
      if (!this.container) return [];

      try {
        const response = await fetch(this.fetchUrl, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("Transaction request failed");
        }

        const data = await response.json();
        return Array.isArray(data.transactions) ? data.transactions : [];
      } catch (error) {
        console.error("Unable to load social proof transactions:", error);
        this.renderErrorState();
        return [];
      }
    }

    showToast(transaction) {
      if (!this.container || !transaction) return;

      const toast = document.createElement("div");
      toast.className = "social-proof-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      const name = maskName(transaction.investorName || transaction.name || "Investor");
      const plan = transaction.planName || transaction.plan || "Investment Plan";
      const amount = formatCurrency(transaction.amount || 0);
      const timeAgo = formatTimeAgo(transaction.completedAt || transaction.createdAt || new Date());

      toast.innerHTML = `
        <div class="social-proof-icon">✓</div>
        <div class="social-proof-text">
          <div class="social-proof-line">
            <strong>${name}</strong>
            <span>${plan}</span>
          </div>
          <div class="social-proof-meta">Invested ${amount} • ${timeAgo}</div>
        </div>
      `;

      this.container.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.add("show");
      });

      window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 320);
      }, 4400);
    }

    rotateNext() {
      if (!this.container || !this.queue.length) return;

      const transaction = this.queue[this.currentIndex % this.queue.length];
      this.currentIndex += 1;
      this.showToast(transaction);
    }

    async refresh() {
      if (!this.container) return;

      const transactions = await this.loadTransactions();
      if (!transactions.length) {
        this.renderEmptyState();
        return;
      }

      this.queue = transactions;
      this.currentIndex = 0;
      this.container.innerHTML = "";
      this.rotateNext();
    }

    start() {
      if (!this.container) return;
      this.renderLoadingState();
      this.refresh();
      this.timer = window.setInterval(() => this.rotateNext(), this.intervalMs);
    }

    stop() {
      if (this.timer) {
        window.clearInterval(this.timer);
      }
    }
  }

  window.SocialProof = SocialProof;
})();
