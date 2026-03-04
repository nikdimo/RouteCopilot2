const FEATURE_LABELS = {
  "calendar.sync.enabled": "Calendar sync",
  "calendar.sync.max_calendars": "Max calendars",
  "contacts.create.enabled": "Create contacts",
  "geocode.provider.premium": "Premium geocoding",
  "routing.traffic.enabled": "Traffic-aware routing",
  "alerts.running_late.self": "Running-late self alerts",
  "routing.optimize.enabled": "Route optimization",
  "export.day_plan.enabled": "Day-plan export",
  "templates.recurring.enabled": "Recurring templates",
  "assistant.client_notify.enabled": "Client notify assistant",
  "assistant.client_notify.sms": "Client SMS",
  "assistant.client_notify.email": "Client email",
};

const PLAN_ORDER = ["free", "basic", "pro", "premium"];

const STATUS_TEXT = {
  free: "Free",
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete expired",
};

const STATUS_MESSAGE = {
  trialing: "Trial is active. Billing starts at trial end unless canceled.",
  active: "Subscription is active.",
  past_due: "Payment issue detected. Update payment method to avoid interruption.",
  canceled: "Subscription canceled. Access remains until current period end, if applicable.",
  unpaid: "Payment failed and access may be restricted. Fix payment method.",
  incomplete: "Checkout not fully completed. Retry checkout.",
  incomplete_expired: "Checkout expired. Start a new checkout.",
  free: "You are currently on the Free plan.",
};

const state = {
  plans: [],
  snapshot: null,
  interval: "monthly",
  authStatus: "unknown",
};

function $(id) {
  return document.getElementById(id);
}

function query() {
  return new URLSearchParams(window.location.search);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatMoney(cents) {
  const value = Number(cents || 0) / 100;
  return `$${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

function planRank(code) {
  return PLAN_ORDER.indexOf(code);
}

function inferApiBase() {
  const params = query();
  const explicit = params.get("apiBase")?.trim();
  if (explicit) {
    localStorage.setItem("wiseplan.billing.apiBase", explicit.replace(/\/+$/, ""));
    return explicit.replace(/\/+$/, "");
  }

  const stored = localStorage.getItem("wiseplan.billing.apiBase")?.trim();
  if (stored) return stored.replace(/\/+$/, "");

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:4000/api";
  }
  return "https://api.wiseplan.dk/api";
}

function getSessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readTokenFromUrl() {
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
  );
  const fromHash = hashParams.get("token")?.trim();
  if (fromHash) return fromHash;
  const fromQuery = query().get("token")?.trim();
  if (fromQuery) return fromQuery;
  return "";
}

function scrubTokenFromUrl() {
  if (!window.history || typeof window.history.replaceState !== "function") {
    return;
  }
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      changed = true;
    }
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    if (hashParams.has("token")) {
      hashParams.delete("token");
      url.hash = hashParams.toString();
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, document.title, url.toString());
    }
  } catch {
    // ignore malformed URL edge cases
  }
}

function getAuthToken() {
  const fromUrl = readTokenFromUrl();
  const sessionStore = getSessionStore();
  const localStore = getLocalStore();

  if (fromUrl) {
    if (sessionStore) {
      sessionStore.setItem("wiseplan.billing.token", fromUrl);
      localStore?.removeItem("wiseplan.billing.token");
    } else if (localStore) {
      localStore.setItem("wiseplan.billing.token", fromUrl);
    }
    scrubTokenFromUrl();
    return fromUrl;
  }

  const sessionToken = sessionStore?.getItem("wiseplan.billing.token")?.trim();
  if (sessionToken) {
    return sessionToken;
  }

  const localToken = localStore?.getItem("wiseplan.billing.token")?.trim();
  if (localToken) {
    if (sessionStore) {
      sessionStore.setItem("wiseplan.billing.token", localToken);
      localStore?.removeItem("wiseplan.billing.token");
    }
    return localToken;
  }

  return "";
}

function idempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function api(path, options = {}) {
  const apiBase = inferApiBase();
  const token = getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error || `${response.status} ${response.statusText}`,
      payload,
    };
  }

  return {
    ok: true,
    status: response.status,
    payload,
  };
}

function statusClass(status) {
  if (!status) return "status";
  return `status ${status}`;
}

function statusBannerHtml(status, snapshot) {
  const message = STATUS_MESSAGE[status] || "Status available.";
  const lines = [];
  if (snapshot?.subscription?.trialEnd) {
    lines.push(`Trial ends: ${formatDateTime(snapshot.subscription.trialEnd)}`);
  }
  if (snapshot?.renewalAt) {
    lines.push(`Renews: ${formatDateTime(snapshot.renewalAt)}`);
  }
  if (snapshot?.accessEndsAt) {
    lines.push(`Access ends: ${formatDateTime(snapshot.accessEndsAt)}`);
  }

  let tone = "ok";
  if (status === "past_due" || status === "incomplete" || status === "incomplete_expired") {
    tone = "warn";
  }
  if (status === "unpaid" || status === "canceled") {
    tone = "danger";
  }

  return `<div class="banner ${tone}">
    <strong>${escapeHtml(STATUS_TEXT[status] || status)}</strong>
    <div class="mini">${escapeHtml(message)}</div>
    ${lines.length ? `<div class="mini">${lines.map(escapeHtml).join(" • ")}</div>` : ""}
  </div>`;
}

function renderMatrix(plans) {
  // Matrix is removed in the new UI design.
  const wrap = $("matrixWrap");
  if (wrap) wrap.innerHTML = "";
}

async function loadPublicPlans() {
  const result = await api("/public/plans");
  if (!result.ok) {
    throw new Error(result.error || "Failed to load plans");
  }
  state.plans = (result.payload?.plans || []).sort(
    (a, b) => planRank(a.code) - planRank(b.code)
  );
  return state.plans;
}

async function loadSnapshot() {
  const result = await api("/billing/me");
  if (!result.ok) {
    if (result.status === 401) {
      state.authStatus = "unauthorized";
      return null;
    }
    throw new Error(result.error || "Failed to load billing status");
  }
  state.authStatus = "ok";
  state.snapshot = result.payload;
  return result.payload;
}

function billingContextFromQuery() {
  const params = query();
  return {
    source: params.get("source") || "web",
    feature: params.get("feature") || undefined,
  };
}

function renderBillingHeaderSnapshot() {
  const wrap = $("snapshotWrap");
  if (!wrap) return;

  const manageBtn = $("manageBillingBtn");
  if (manageBtn) {
    manageBtn.style.display = state.authStatus === "ok" && state.snapshot ? "inline-flex" : "none";
  }

  if (state.authStatus === "unauthorized") {
    wrap.innerHTML = `
      <div class="banner warn" style="margin-top: 0;">
        <strong>Sign in required for checkout</strong>
        <div class="mini">Pricing is public. To buy or manage, open billing from the app.</div>
      </div>
    `;
    return;
  }

  if (!state.snapshot) return;

  const status = state.snapshot.statusBanner || "free";

  // Only show banner if there's an action needed or a trial
  if (status !== "active" && status !== "free") {
    wrap.innerHTML = statusBannerHtml(status, state.snapshot);
  } else {
    wrap.innerHTML = "";
  }
}

async function validatePromoForPlan(planCode, interval, promoCode) {
  if (!promoCode) return null;
  const result = await api("/billing/promo/validate", {
    method: "POST",
    body: {
      code: promoCode,
      planCode,
      billingInterval: interval,
    },
  });
  if (!result.ok) {
    throw new Error(result.error || "Promo validation failed");
  }
  return result.payload;
}

function renderPromoResult(result) {
  const box = $("promoResult");
  if (!box) return;
  if (!result) {
    box.innerHTML = "";
    return;
  }
  if (!result.valid) {
    box.innerHTML = `<div class="banner danger mini">${escapeHtml(result.reason || "Invalid code")}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="banner ok mini">
      Promo valid: <strong>${escapeHtml(result.promotion?.code || "")}</strong><br>
      ${escapeHtml(formatMoney(result.preview.baseAmountCents))} - ${escapeHtml(formatMoney(result.preview.discountAmountCents))}
      = <strong>${escapeHtml(formatMoney(result.preview.finalAmountCents))}</strong>
    </div>
  `;
}

function toErrorMessage(error, fallback) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
}

function getCurrentPlanCode() {
  return state.snapshot?.currentPlan || "free";
}

const PLAN_FEATURES = {
  free: [
    "Local-only meetings",
    "Nominatim address search",
    "Standard OSRM routing",
    "Manual buffer controls",
    "Device-only storage"
  ],
  basic: [
    "1 Outlook calendar sync",
    "Contact creation tool",
    "Google Geocoding Pro",
    "Priority route resolution",
    "24h support response"
  ],
  pro: [
    "Unlimited calendar sync",
    "Real-time traffic engine",
    "Smart 'Running Late' alerts",
    "Multi-stop optimization",
    "One-click PDF exports",
    "Meeting templates"
  ],
  premium: [
    "Everything in Pro",
    "AI Assistant drafting",
    "Auto SMS/Email to client",
    "Live ETA client portal",
    "100 SMS credits / mo",
    "VIP Priority Support"
  ]
};

function renderPlanCards() {
  const wrap = $("plansGrid");
  if (!wrap) return;
  const currentPlan = getCurrentPlanCode();
  const cards = state.plans
    .map((plan) => {
      const monthlyAmountCents = Number(plan?.prices?.monthly?.amountCents ?? 0);
      const annualBilledYearlyCents = Number(plan?.prices?.annual?.amountCentsBilledYearly ?? 0);
      const annualMonthlyAmountCents = Number(plan?.prices?.annual?.amountCentsEffectiveMonthly ?? 0);
      const displayAmountCents =
        state.interval === "monthly"
          ? monthlyAmountCents
          : annualMonthlyAmountCents || Math.round(annualBilledYearlyCents / 12) || monthlyAmountCents;
      const billingSubline =
        state.interval === "annual" && annualBilledYearlyCents > 0
          ? `Billed ${formatMoney(annualBilledYearlyCents)} yearly`
          : "";
      const isCurrent = plan.code === currentPlan;
      const upgrading = planRank(plan.code) > planRank(currentPlan);

      let ctaLabel = isCurrent ? "YOUR PLAN" : (plan.code === "free" ? "MANAGE" : (upgrading ? "UPGRADE NOW" : "DOWNGRADE"));
      let btnClass = isCurrent ? "btn block ghost" : (plan.code === "pro" ? "btn block primary" : "btn block dark");
      if (plan.code === "pro" && !isCurrent) ctaLabel = "GET PRO ACCESS";
      if (plan.code === "premium" && !isCurrent) ctaLabel = "GET PREMIUM";

      const featureItems = (PLAN_FEATURES[plan.code] || []).map(f => `
        <li>
          <svg class="check-icon ${plan.code === 'pro' ? 'pro-icon' : ''}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          ${escapeHtml(f)}
        </li>
      `).join("");

      const isPro = plan.code === "pro";

      return `
      <div class="card ${isPro ? 'pro-card' : ''}">
        ${isPro ? '<div class="badge-recommend">★ RECOMMEND</div>' : ''}
        
        <div class="plan-icon icon-${escapeHtml(plan.code)}">
          ${plan.code === 'free' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>'
          : plan.code === 'basic' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>'
            : plan.code === 'pro' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
              : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>'
        }
        </div>
        
        <h3 class="plan-name">${escapeHtml(plan.name)}</h3>
        <div class="price-wrap">
          <span class="price">${escapeHtml(formatMoney(displayAmountCents))}</span>
          <span class="price-period">/mo</span>
        </div>
        <div class="price-sub">
          ${escapeHtml(plan.description)}
          ${billingSubline ? `<br><span class="muted">${escapeHtml(billingSubline)}</span>` : ""}
        </div>
        
        <ul class="feature-list">
          ${featureItems}
        </ul>
        
        <button class="${btnClass}"
          data-action="choose-plan"
          data-plan-code="${escapeHtml(plan.code)}"
          ${isCurrent ? "disabled" : ""}>
          ${escapeHtml(ctaLabel)}
        </button>
      </div>`;
    })
    .join("");
  wrap.innerHTML = cards;
}

async function handlePlanCheckout(planCode) {
  if (state.authStatus === "unauthorized") {
    renderPromoResult({ valid: false, reason: "Sign in is required to start checkout." });
    return;
  }
  const promoCode = $("promoInput")?.value?.trim();
  if (promoCode) {
    const promo = await validatePromoForPlan(planCode, state.interval, promoCode);
    renderPromoResult(promo);
    if (!promo?.valid) {
      return;
    }
  }

  const context = billingContextFromQuery();
  const result = await api("/billing/checkout-session", {
    method: "POST",
    idempotencyKey: idempotencyKey(),
    body: {
      planCode,
      billingInterval: state.interval,
      promoCode: promoCode || undefined,
      source: context.source,
      feature: context.feature,
    },
  });
  if (!result.ok) {
    renderPromoResult({ valid: false, reason: result.error || "Checkout failed." });
    return;
  }
  window.location.href = result.payload.checkoutUrl;
}

async function openManageBilling() {
  const result = await api("/billing/customer-portal-session", { method: "POST" });
  if (!result.ok) {
    renderPromoResult({ valid: false, reason: result.error || "Could not open billing portal." });
    return;
  }
  window.location.href = result.payload.portalUrl;
}

function bindBillingPageEvents() {
  $("showPromoBtn")?.addEventListener("click", () => {
    $("promoInputWrap")?.classList.toggle("hidden");
  });

  $("intervalMonthly")?.addEventListener("click", () => {
    state.interval = "monthly";
    $("intervalMonthly").classList.add("active");
    $("intervalAnnual").classList.remove("active");
    renderPlanCards();
  });
  $("intervalAnnual")?.addEventListener("click", () => {
    state.interval = "annual";
    $("intervalAnnual").classList.add("active");
    $("intervalMonthly").classList.remove("active");
    renderPlanCards();
  });

  $("plansGrid")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='choose-plan']");
    if (!button) return;
    const planCode = button.dataset.planCode;
    if (!planCode) return;
    try {
      if (planCode === "free") {
        await openManageBilling();
        return;
      }
      await handlePlanCheckout(planCode);
    } catch (error) {
      renderPromoResult({
        valid: false,
        reason: toErrorMessage(error, "Could not start checkout. Verify API reachability and sign-in token."),
      });
    }
  });

  $("promoValidateBtn")?.addEventListener("click", async () => {
    const promoCode = $("promoInput")?.value?.trim() || "";
    if (!promoCode) {
      renderPromoResult(null);
      return;
    }
    const targetPlan = getCurrentPlanCode() === "free" ? "basic" : getCurrentPlanCode();
    try {
      const promo = await validatePromoForPlan(targetPlan, state.interval, promoCode);
      renderPromoResult(promo);
    } catch (error) {
      renderPromoResult({ valid: false, reason: error.message || "Promo validation failed." });
    }
  });

  $("manageBillingBtn")?.addEventListener("click", async () => {
    try {
      await openManageBilling();
    } catch (error) {
      renderPromoResult({
        valid: false,
        reason: toErrorMessage(error, "Could not open billing portal. Verify API reachability and sign-in token."),
      });
    }
  });
}

function renderSnapshotDetails(containerId, snapshot) {
  const wrap = $(containerId);
  if (!wrap) return;
  if (!snapshot) {
    wrap.innerHTML = "<div class='muted'>No billing profile available.</div>";
    return;
  }

  const status = snapshot.statusBanner || "free";
  const planName = snapshot.currentPlan ? snapshot.currentPlan.charAt(0).toUpperCase() + snapshot.currentPlan.slice(1) : "Free";

  const entitlements = Object.entries(snapshot.entitlements || {})
    .map(([key, value]) => {
      const isOff = value === "false" || value === false || value === 0 || value === "0";
      const isUnlimited = value === -1 || value === "-1";
      const isTrue = value === "true" || value === true;

      let displayValue = value;
      if (isUnlimited) displayValue = "Unlimited";
      else if (isTrue) displayValue = "Included";
      else if (isOff) displayValue = "Not included";

      const icon = isOff
        ? `<svg class="entitlement-icon off" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
        : `<svg class="entitlement-icon on" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      return `
        <div class="entitlement-card ${isOff ? 'disabled' : ''}">
          ${icon}
          <div class="entitlement-info">
            <div class="entitlement-label">${escapeHtml(FEATURE_LABELS[key] || key)}</div>
            <div class="entitlement-value">${escapeHtml(displayValue)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  wrap.innerHTML = `
    <div class="account-dashboard-header">
      <div class="plan-info-group">
        <div class="mini muted uppercase fw-bold" style="letter-spacing: 0.05em;">Current Plan</div>
        <div class="plan-title-large">${escapeHtml(planName)}</div>
      </div>
      <div class="status-badge-large ${status}">${escapeHtml(STATUS_TEXT[status] || status)}</div>
    </div>
    
    <div class="banner-container">
      ${statusBannerHtml(status, snapshot)}
    </div>

    <div class="entitlements-section">
      <h3 class="entitlements-heading">Plan Features & Limits</h3>
      <div class="entitlements-grid">
        ${entitlements}
      </div>
    </div>
  `;
}

async function initBillingPage() {
  bindBillingPageEvents();
  const feature = query().get("feature");
  const featureHint = $("featureHint");
  if (feature && featureHint) {
    const label = FEATURE_LABELS[feature] || feature;
    featureHint.innerHTML = `
      <div class="banner warn">
        Requested feature: <strong>${escapeHtml(label)}</strong>
        <div class="mini">Choose a plan that includes this entitlement key.</div>
      </div>
    `;
  }
  try {
    await loadPublicPlans();
    try {
      await loadSnapshot();
    } catch (snapshotError) {
      console.warn(snapshotError);
    }
    renderMatrix(state.plans);
    renderPlanCards();
    renderBillingHeaderSnapshot();
  } catch (error) {
    const wrap = $("plansGrid");
    if (wrap) {
      wrap.innerHTML = `<div class="banner danger">${escapeHtml(error.message || "Billing page failed to load.")}</div>`;
    }
  }
}

async function initCheckoutPage() {
  const status = $("checkoutStatus");
  const params = query();
  const provider = params.get("provider");
  const session = params.get("session");

  if (provider !== "mock" || !session) {
    status.textContent = "Invalid checkout session. Return to billing.";
    return;
  }

  status.textContent = "Completing checkout...";
  const result = await api("/billing/mock/complete-checkout", {
    method: "POST",
    body: { checkoutSessionId: session },
  });
  if (!result.ok) {
    status.textContent = `Checkout completion failed: ${result.error || "Unknown error"} `;
    return;
  }
  window.location.replace(`/billing/success?session=${encodeURIComponent(session)}`);
}

async function initSuccessPage() {
  const statusNode = $("successStatus");
  const detailsNode = $("successDetails");
  statusNode.textContent = "Waiting for billing status to update...";
  const startedAt = Date.now();

  const tick = async () => {
    const result = await api("/billing/me");
    if (!result.ok) {
      statusNode.textContent = "Could not read billing status yet. Retrying...";
      return false;
    }

    const snapshot = result.payload;
    const status = snapshot.statusBanner || "free";
    statusNode.innerHTML = `Status: <span class="${statusClass(status)}">${escapeHtml(
      STATUS_TEXT[status] || status
    )}</span>`;
    detailsNode.innerHTML = statusBannerHtml(status, snapshot);

    if (status !== "incomplete" && status !== "incomplete_expired") {
      return true;
    }
    return false;
  };

  const intervalId = setInterval(async () => {
    const done = await tick();
    if (done || Date.now() - startedAt > 60000) {
      clearInterval(intervalId);
    }
  }, 2500);

  await tick();
}

async function initAccountBillingPage() {
  const snapshotWrap = $("accountSnapshot");
  const invoicesWrap = $("invoicesWrap");
  $("accountManageBtn")?.addEventListener("click", async () => {
    await openManageBilling();
  });

  const snapshotResult = await api("/billing/me");
  if (!snapshotResult.ok) {
    snapshotWrap.innerHTML = `<div class="banner danger">${escapeHtml(
      snapshotResult.error || "Could not load account billing snapshot."
    )}</div>`;
    return;
  }

  renderSnapshotDetails("accountSnapshot", snapshotResult.payload);

  const invoiceResult = await api("/billing/invoices");
  if (!invoiceResult.ok) {
    invoicesWrap.innerHTML = `<div class="banner warn">${escapeHtml(
      invoiceResult.error || "Could not load invoices."
    )}</div>`;
    return;
  }

  const rows = (invoiceResult.payload.invoices || [])
    .map(
      (invoice) => `
      <tr>
        <td>${escapeHtml(formatDateTime(invoice.createdAt))}</td>
        <td>${escapeHtml(invoice.status)}</td>
        <td>${escapeHtml(formatMoney(invoice.amountDueCents))}</td>
        <td>${escapeHtml(formatMoney(invoice.amountPaidCents))}</td>
        <td>${invoice.hostedInvoiceUrl ? `<a href="${escapeHtml(invoice.hostedInvoiceUrl)}" target="_blank" rel="noopener">Open</a>` : "—"}</td>
      </tr>`
    )
    .join("");

  invoicesWrap.innerHTML = rows
    ? `
      <table class="table">
        <thead>
          <tr><th>Created</th><th>Status</th><th>Due</th><th>Paid</th><th>Invoice</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    : "<div class='muted'>No invoices yet.</div>";
}

async function init() {
  const page = document.body.dataset.page;
  if (page === "billing") return initBillingPage();
  if (page === "checkout") return initCheckoutPage();
  if (page === "success") return initSuccessPage();
  if (page === "account-billing") return initAccountBillingPage();
  return null;
}

init().catch((error) => {
  console.error(error);
});
