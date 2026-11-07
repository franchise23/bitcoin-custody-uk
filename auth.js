const API_BASE =
  (window.QuantumUtils && typeof window.QuantumUtils.resolveApiBase === "function"
    ? window.QuantumUtils.resolveApiBase(window.API_BASE)
    : window.API_BASE || "https://bitcoin-custody-uk.onrender.com");

function setFeedback(element, message, type = "error") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("error", "success", "info");
  if (message) {
    element.classList.add(type);
  }
}

function setButtonLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Please wait...";
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input || !button) return;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  button.textContent = isHidden ? "Hide" : "Show";
  button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
}

function getLoginErrorMessage(error) {
  const rawMessage = error?.message || String(error || "");
  const normalized = (rawMessage || "").toLowerCase();

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("fetch resource") ||
    normalized.includes("load failed") ||
    normalized.includes("cors") ||
    normalized.includes("blocked")
  ) {
    return `Authentication server is unreachable. Check that the backend is running and CORS is enabled for ${API_BASE}.`;
  }

  if (
    normalized.includes("unexpected token") ||
    normalized.includes("json") ||
    normalized.includes("parseerror")
  ) {
    return `The authentication server returned an invalid response. Check the backend at ${API_BASE}.`;
  }

  return rawMessage || "Unable to log in right now.";
}

function getPasswordChecks(password) {
  return [
    { key: "length", label: "8+ characters", ok: password.length >= 8 },
    { key: "uppercase", label: "One uppercase letter", ok: /[A-Z]/.test(password) },
    { key: "lowercase", label: "One lowercase letter", ok: /[a-z]/.test(password) },
    { key: "number", label: "One number", ok: /\d/.test(password) },
    { key: "special", label: "One special character", ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password) },
  ];
}

function renderPasswordState(password, meter, text, requirements) {
  const checks = getPasswordChecks(password);
  const score = checks.filter((check) => check.ok).length;
  const percent = (score / checks.length) * 100;

  if (meter) {
    meter.style.width = `${percent}%`;
    meter.classList.remove("weak", "medium", "strong");
    if (score <= 2) meter.classList.add("weak");
    else if (score <= 4) meter.classList.add("medium");
    else meter.classList.add("strong");
  }

  if (text) {
    if (!password) {
      text.textContent = "Password strength: not started";
    } else if (score <= 2) {
      text.textContent = "Password strength: weak";
    } else if (score <= 4) {
      text.textContent = "Password strength: medium";
    } else {
      text.textContent = "Password strength: strong";
    }
  }

  if (requirements) {
    requirements.querySelectorAll("li").forEach((item, index) => {
      const check = checks[index];
      const isOk = Boolean(check && check.ok);
      item.classList.toggle("is-valid", isOk);
      item.classList.toggle("is-invalid", !isOk && Boolean(password));
      const status = item.querySelector("span");
      if (status) {
        status.textContent = isOk ? "✓" : "•";
      }
    });
  }
}

function validateRegistrationForm() {
  const name = document.getElementById("register-name")?.value.trim() || "";
  const username = document.getElementById("register-username")?.value.trim() || "";
  const email = document.getElementById("register-email")?.value.trim() || "";
  const password = document.getElementById("register-password")?.value || "";
  const confirmPassword = document.getElementById("register-confirm-password")?.value || "";
  const button = document.getElementById("register-button");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const usernameValid = /^[a-z0-9._-]{3,24}$/i.test(username);
  const passwordValid = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,}$/.test(password);
  const passwordMatch = password && confirmPassword && password === confirmPassword;
  const valid = Boolean(name && usernameValid && emailValid && passwordValid && passwordMatch);

  if (button) {
    button.disabled = !valid;
  }

  const confirmMessage = document.getElementById("password-confirm-message");
  if (confirmMessage) {
    if (confirmPassword && password !== confirmPassword) {
      confirmMessage.textContent = "Passwords do not match.";
      confirmMessage.classList.add("error");
    } else if (confirmPassword && password === confirmPassword) {
      confirmMessage.textContent = "Passwords match.";
      confirmMessage.classList.remove("error");
      confirmMessage.classList.add("success");
    } else {
      confirmMessage.textContent = "";
      confirmMessage.classList.remove("error", "success");
    }
  }

  return valid;
}

function setupRegistrationPage() {
  const form = document.getElementById("register-form");
  const passwordInput = document.getElementById("register-password");
  const confirmInput = document.getElementById("register-confirm-password");
  const meter = document.getElementById("password-strength-meter");
  const text = document.getElementById("password-strength-text");
  const list = document.getElementById("password-requirements");
  const feedback = document.getElementById("auth-feedback");
  const submitButton = document.getElementById("register-button");

  if (!form) return;

  const requirementItems = list ? list.querySelectorAll("li") : [];
  const applyState = () => {
    const value = passwordInput ? passwordInput.value : "";
    renderPasswordState(value, meter, text, list);
    validateRegistrationForm();
  };

  if (passwordInput) {
    passwordInput.addEventListener("input", applyState);
  }
  if (confirmInput) {
    confirmInput.addEventListener("input", validateRegistrationForm);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateRegistrationForm()) {
      setFeedback(feedback, "Please complete all fields with valid information before submitting.", "error");
      return;
    }

    const payload = {
      name: document.getElementById("register-name")?.value.trim(),
      username: document.getElementById("register-username")?.value.trim(),
      email: document.getElementById("register-email")?.value.trim(),
      password: document.getElementById("register-password")?.value,
      confirmPassword: document.getElementById("register-confirm-password")?.value,
    };

    setButtonLoading(submitButton, true);
    setFeedback(feedback, "", "error");

    try {
      const response = await fetch(`${API_BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Registration failed.");
      }

      window.location.href = `verify-email.html?email=${encodeURIComponent(data.email || payload.email)}`;
    } catch (error) {
      setFeedback(feedback, error.message || "Unable to register right now.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });

  if (requirementItems.length) {
    requirementItems.forEach((item) => {
      const label = item.querySelector("span:last-child");
      if (label) {
        label.textContent = label.dataset.label || label.textContent;
      }
    });
  }

  applyState();
}

function setupLoginPage() {
  const form = document.getElementById("login-form");
  const submitButton = document.getElementById("login-button");
  const feedback = document.getElementById("auth-feedback");
  const passwordInput = document.getElementById("login-password");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = document.getElementById("login-identifier")?.value.trim();
    const password = passwordInput ? passwordInput.value : "";

    if (!identifier || !password) {
      setFeedback(feedback, "Please enter your username or email and password.", "error");
      return;
    }

    setButtonLoading(submitButton, true);
    setFeedback(feedback, "", "error");

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Login failed.");
      }

      localStorage.setItem("qlnToken", data.token);
      localStorage.setItem("qlnCurrentUser", JSON.stringify(data.user));
      window.location.href = "dashboard.html";
    } catch (error) {
      setFeedback(feedback, getLoginErrorMessage(error), "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function setupForgotPasswordPage() {
  const form = document.getElementById("forgot-form");
  const feedback = document.getElementById("auth-feedback");
  const submitButton = document.getElementById("forgot-button");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("forgot-email")?.value.trim();
    if (!email) {
      setFeedback(feedback, "Please enter your email address.", "error");
      return;
    }

    setButtonLoading(submitButton, true);
    setFeedback(feedback, "", "info");

    try {
      const response = await fetch(`${API_BASE}/api/request-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Unable to send password reset email.");
      }

      setFeedback(feedback, data.message || "If an account exists, a reset email has been sent.", "success");
    } catch (error) {
      setFeedback(feedback, error.message || "Unable to process password reset request.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function setupResetPasswordPage() {
  const form = document.getElementById("reset-form");
  const feedback = document.getElementById("auth-feedback");
  const submitButton = document.getElementById("reset-button");
  const passwordInput = document.getElementById("reset-password");
  const confirmInput = document.getElementById("reset-confirm-password");
  const meter = document.getElementById("reset-strength-meter");
  const label = document.getElementById("reset-strength-text");
  const list = document.getElementById("reset-requirements");
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    setFeedback(feedback, "Missing or invalid reset token.", "error");
    return;
  }

  const applyState = () => {
    const value = passwordInput ? passwordInput.value : "";
    renderPasswordState(value, meter, label, list);
    const confirmMatch = confirmInput && confirmInput.value && value === confirmInput.value;
    if (confirmInput && confirmInput.value && value !== confirmInput.value) {
      setFeedback(feedback, "Passwords do not match.", "error");
    } else if (confirmInput && confirmInput.value && confirmMatch) {
      setFeedback(feedback, "Passwords match.", "success");
    }
  };

  if (passwordInput) passwordInput.addEventListener("input", applyState);
  if (confirmInput) confirmInput.addEventListener("input", applyState);

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = passwordInput ? passwordInput.value : "";
    const confirmPassword = confirmInput ? confirmInput.value : "";

    if (!isStrongPassword(password) || password !== confirmPassword) {
      setFeedback(feedback, "Please enter a valid password and matching confirmation.", "error");
      return;
    }

    setButtonLoading(submitButton, true);
    setFeedback(feedback, "", "info");

    try {
      const response = await fetch(`${API_BASE}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Unable to reset password.");
      }

      setFeedback(feedback, data.message || "Password updated successfully.", "success");
      setTimeout(() => window.location.href = "login.html", 1200);
    } catch (error) {
      setFeedback(feedback, error.message || "Unable to reset password.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function isStrongPassword(password) {
  return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,}$/.test(password || "");
}

function setupVerifyPage() {
  const form = document.getElementById("verification-form");
  const inputs = Array.from(document.querySelectorAll(".otp-input"));
  const feedback = document.getElementById("auth-feedback");
  const submitButton = document.getElementById("verify-button");
  const resendButton = document.getElementById("resend-code");
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email") || "";

  if (!form || !inputs.length) return;

  const fillCodeFromInput = () => inputs.map((input) => input.value).join("");

  inputs.forEach((input, index) => {
    input.addEventListener("input", (event) => {
      const value = event.target.value.replace(/\D/g, "").slice(-1);
      event.target.value = value;
      if (value && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });

  inputs[0].addEventListener("paste", (event) => {
    const pasted = (event.clipboardData || window.clipboardData).getData("text");
    const digits = pasted.replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    digits.split("").forEach((digit, idx) => {
      if (inputs[idx]) inputs[idx].value = digit;
    });
    const lastIndex = Math.min(digits.length, inputs.length) - 1;
    if (inputs[lastIndex]) inputs[lastIndex].focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = fillCodeFromInput();
    if (!email || !/^\d{6}$/.test(code)) {
      setFeedback(feedback, "Please enter the full six-digit code.", "error");
      return;
    }

    setButtonLoading(submitButton, true);
    setFeedback(feedback, "", "info");

    try {
      const response = await fetch(`${API_BASE}/api/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Verification failed.");
      }

      localStorage.setItem("qlnToken", data.token);
      localStorage.setItem("qlnCurrentUser", JSON.stringify(data.user));
      setFeedback(feedback, data.message || "Account verified successfully.", "success");
      setTimeout(() => {
        window.location.href = data.redirectTo || "dashboard.html";
      }, 800);
    } catch (error) {
      setFeedback(feedback, error.message || "Verification could not be completed.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });

  if (resendButton) {
    let countdown = 60;
    const updateButton = () => {
      resendButton.disabled = countdown > 0;
      resendButton.textContent = countdown > 0 ? `Resend code (${countdown}s)` : "Resend code";
    };
    updateButton();

    const timer = setInterval(() => {
      countdown -= 1;
      updateButton();
      if (countdown <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    resendButton.addEventListener("click", async () => {
      if (countdown > 0) return;
      setButtonLoading(resendButton, true);
      try {
        const response = await fetch(`${API_BASE}/api/register/resend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Unable to resend code.");
        setFeedback(feedback, data.message || "A new code has been sent.", "success");
        countdown = 60;
        updateButton();
        const retryTimer = setInterval(() => {
          countdown -= 1;
          updateButton();
          if (countdown <= 0) {
            clearInterval(retryTimer);
          }
        }, 1000);
      } catch (error) {
        setFeedback(feedback, error.message || "Unable to resend code.", "error");
      } finally {
        setButtonLoading(resendButton, false);
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "register") setupRegistrationPage();
  if (page === "login") setupLoginPage();
  if (page === "forgot") setupForgotPasswordPage();
  if (page === "reset") setupResetPasswordPage();
  if (page === "verify") setupVerifyPage();

  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.togglePassword;
      togglePasswordVisibility(target, button);
    });
  });
});
