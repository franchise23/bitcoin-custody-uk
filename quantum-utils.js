(function (global) {
  const DEFAULT_API_BASES = [
    "http://localhost:4100",
    "https://quantum-ledger-org.onrender.com",
    "https://bitcoin-custody-uk.onrender.com",
  ];

  const COMPLETED_STATUSES = new Set([
    "completed",
    "complete",
    "success",
    "paid",
    "settled",
  ]);

  function resolveApiBase(explicitBase) {
    const candidates = [explicitBase, global.API_BASE, ...DEFAULT_API_BASES].filter(Boolean);
    const unique = [];

    candidates.forEach((candidate) => {
      const value = String(candidate).trim();
      if (!value || unique.includes(value)) return;
      unique.push(value);
    });

    return unique[0] || "http://localhost:4100";
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isCompletedTransaction(transaction) {
    if (!transaction || transaction.isPublic === false) return false;

    const status = normalizeStatus(transaction.status || transaction.state || transaction.transactionStatus || "");
    return COMPLETED_STATUSES.has(status);
  }

  function normalizeTransactions(transactions) {
    if (!Array.isArray(transactions)) return [];

    return transactions
      .filter(isCompletedTransaction)
      .sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0));
  }

  const api = {
    DEFAULT_API_BASES,
    resolveApiBase,
    normalizeStatus,
    isCompletedTransaction,
    normalizeTransactions,
    SAMPLE_COMPLETED_TRANSACTIONS: [
      { id: "tx-1001", investorName: "Alicia M.", planName: "Growth Plus", amount: 2400, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
      { id: "tx-1002", investorName: "Daniel C.", planName: "Starter Capital", amount: 1500, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString() },
      { id: "tx-1003", investorName: "Renee T.", planName: "Income Max", amount: 6400, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString() },
      { id: "tx-1004", investorName: "Samuel K.", planName: "Growth Plus", amount: 3200, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 27 * 60 * 1000).toISOString() },
      { id: "tx-1005", investorName: "Priya N.", planName: "Starter Capital", amount: 950, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 41 * 60 * 1000).toISOString() },
      { id: "tx-1006", investorName: "Marcus H.", planName: "Income Max", amount: 8700, status: "completed", isPublic: true, completedAt: new Date(Date.now() - 58 * 60 * 1000).toISOString() },
    ],
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.QuantumUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
