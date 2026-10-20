// Simple live crypto price loader using CoinGecko public API
// No API key needed for basic use

const API_BASE =
  window.API_BASE ||
  "https://bitcoin-custody-uk.onrender.com"; // backend base URL (prod); override by setting window.API_BASE before script loads

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

        setCurrentUser(data.user);
        setToken(data.token);
        closeModal();
        redirectToDashboard();
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
    fetchUrl: `${window.API_BASE || "http://localhost:4000"}/api/transactions?limit=8`,
    intervalMs: 10000,
  });

  feed.start();
}

/**
 * Initialize everything on page load
 */
document.addEventListener("DOMContentLoaded", () => {
  loadPrices();
  setupMobileNav();
  setupSmoothScroll();
  setupScrollReveal();
  setupContactForm();
  setupAuthSystem();
  setupSocialProof();
});

