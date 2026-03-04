const state = {
  apiBase: "http://localhost:4000/api",
  token: "",
};

const tiers = ["free", "basic", "pro", "premium"];

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const node = $("statusText");
  node.textContent = message;
  node.style.color = isError ? "#c62828" : "#5a6775";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function yesNo(flag) {
  return flag ? "Yes" : "No";
}

function readConnectionInputs() {
  state.apiBase = $("apiBaseInput").value.trim().replace(/\/+$/, "");
  state.token = $("tokenInput").value.trim();
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const message = data?.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

function renderTable(targetId, headers, rowsHtml) {
  const wrap = $(targetId);
  if (!rowsHtml.length) {
    wrap.innerHTML = `<div class="muted" style="padding:12px;">No results</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rowsHtml.join("")}
      </tbody>
    </table>
  `;
}

async function connect() {
  readConnectionInputs();
  setStatus("Connecting...");
  try {
    const data = await api("/admin/me");
    $("mePre").textContent = JSON.stringify(data, null, 2);
    setStatus("Connected");
  } catch (error) {
    $("mePre").textContent = String(error?.message || error);
    setStatus(`Connect failed: ${error.message}`, true);
  }
}

async function loadUsers() {
  readConnectionInputs();
  const search = $("userSearchInput").value.trim();
  const query = new URLSearchParams({ limit: "100" });
  if (search) query.set("search", search);
  setStatus("Loading users...");
  try {
    const data = await api(`/admin/users?${query.toString()}`);
    const rows = (data.users || []).map((user) => {
      const tierValue = user.tierOverride || "free";
      const tierOptions = tiers
        .map((tier) => `<option value="${tier}" ${tier === tierValue ? "selected" : ""}>${tier}</option>`)
        .join("");
      return `
        <tr data-user-id="${escapeHtml(user.id)}">
          <td><code>${escapeHtml(user.id)}</code></td>
          <td>${escapeHtml(user.email || "-")}</td>
          <td>${escapeHtml(user.displayName || "-")}</td>
          <td>${escapeHtml(user.organizationName || "-")}</td>
          <td>${escapeHtml(user.tierOverride || "-")}</td>
          <td>${escapeHtml(user.effectiveTier || "free")}</td>
          <td>${escapeHtml(user.effectiveTierSource || "-")}</td>
          <td>${escapeHtml(user.access?.subscriptionStatus || "-")}</td>
          <td>${escapeHtml(user.access?.trialEndsAt ? formatDate(user.access.trialEndsAt) : "-")}</td>
          <td>${yesNo(user.access?.canEditSettings)}</td>
          <td>${yesNo(user.profileSettings?.calendarConnected)}</td>
          <td>${yesNo(user.activeFeatures?.advancedGeocodingEnabled)}</td>
          <td>${yesNo(user.activeFeatures?.trafficRoutingEnabled)}</td>
          <td>${yesNo(user.featurePreferences?.useAdvancedGeocoding)}</td>
          <td>${yesNo(user.featurePreferences?.useTrafficRouting)}</td>
          <td>
            <div class="row wrap">
              <select data-role="tier-select">${tierOptions}</select>
              <input data-role="tier-reason" type="text" placeholder="Reason (optional)" />
              <button data-action="save-tier" type="button">Save</button>
              <button class="danger" data-action="remove-tier" type="button">Remove</button>
            </div>
          </td>
        </tr>
      `;
    });
    renderTable(
      "usersTableWrap",
      [
        "User ID",
        "Email",
        "Display Name",
        "Organization",
        "Current Override",
        "Effective Tier",
        "Tier Source",
        "Sub Status",
        "Trial Ends",
        "Can Edit Settings",
        "Calendar Connected",
        "Advanced Active",
        "Traffic Active",
        "Pref: Advanced",
        "Pref: Traffic",
        "Actions",
      ],
      rows
    );
    setStatus(`Loaded ${data.users?.length ?? 0} users`);
  } catch (error) {
    setStatus(`Users load failed: ${error.message}`, true);
  }
}

async function loadOverrides() {
  readConnectionInputs();
  setStatus("Loading tier overrides...");
  try {
    const data = await api("/admin/tier-overrides?limit=100");
    const rows = (data.overrides || []).map(
      (row) => `
        <tr>
          <td><code>${escapeHtml(row.userId)}</code></td>
          <td>${escapeHtml(row.email || "-")}</td>
          <td>${escapeHtml(row.displayName || "-")}</td>
          <td>${escapeHtml(row.subscriptionTier)}</td>
          <td>${escapeHtml(row.reason || "-")}</td>
          <td>${formatDate(row.updatedAt)}</td>
        </tr>
      `
    );
    renderTable(
      "overridesTableWrap",
      ["User ID", "Email", "Display Name", "Tier", "Reason", "Updated"],
      rows
    );
    setStatus(`Loaded ${data.overrides?.length ?? 0} overrides`);
  } catch (error) {
    setStatus(`Overrides load failed: ${error.message}`, true);
  }
}

async function saveTierOverride(userId, subscriptionTier, reason) {
  await api("/admin/tier-overrides", {
    method: "POST",
    body: {
      userId,
      subscriptionTier,
      reason: reason || undefined,
    },
  });
}

async function removeTierOverride(userId) {
  await api(`/admin/tier-overrides/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

async function loadAllowlist() {
  readConnectionInputs();
  setStatus("Loading allowlist...");
  try {
    const data = await api("/admin/admin-allowlist");
    const rows = (data.admins || []).map(
      (admin) => `
        <tr>
          <td><code>${escapeHtml(admin.userId)}</code></td>
          <td>${escapeHtml(admin.email || "-")}</td>
          <td>${escapeHtml(admin.displayName || "-")}</td>
          <td>${escapeHtml(admin.role)}</td>
          <td>${formatDate(admin.createdAt)}</td>
          <td>
            <button class="danger" data-action="remove-admin" data-user-id="${escapeHtml(admin.userId)}" type="button">Remove</button>
          </td>
        </tr>
      `
    );
    renderTable(
      "allowlistTableWrap",
      ["User ID", "Email", "Display Name", "Role", "Created", "Actions"],
      rows
    );
    setStatus(`Loaded ${data.admins?.length ?? 0} admin users`);
  } catch (error) {
    setStatus(`Allowlist load failed: ${error.message}`, true);
  }
}

async function upsertAllowlist() {
  readConnectionInputs();
  const userId = $("allowUserIdInput").value.trim();
  const role = $("allowRoleSelect").value;
  if (!userId) {
    setStatus("User ID is required", true);
    return;
  }
  setStatus("Updating allowlist...");
  try {
    await api("/admin/admin-allowlist", {
      method: "POST",
      body: { userId, role },
    });
    setStatus("Allowlist updated");
    await loadAllowlist();
  } catch (error) {
    setStatus(`Allowlist update failed: ${error.message}`, true);
  }
}

async function removeAdmin(userId) {
  await api(`/admin/admin-allowlist/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

async function loadUserState() {
  readConnectionInputs();
  const dayKey = $("stateDayKeyInput").value.trim();
  const search = $("stateSearchInput").value.trim();
  const query = new URLSearchParams({ limit: "100" });
  if (dayKey) query.set("dayKey", dayKey);
  if (search) query.set("search", search);
  setStatus("Loading user state...");
  try {
    const data = await api(`/admin/user-state?${query.toString()}`);
    const rows = (data.states || []).map(
      (row) => `
        <tr>
          <td><code>${escapeHtml(row.userId)}</code></td>
          <td>${escapeHtml(row.email || "-")}</td>
          <td>${escapeHtml(row.displayName || "-")}</td>
          <td>${escapeHtml(row.dayKey)}</td>
          <td>${escapeHtml(row.completedCount)}</td>
          <td>${escapeHtml(row.orderCount)}</td>
          <td>${formatDate(row.updatedAt)}</td>
        </tr>
      `
    );
    renderTable(
      "stateTableWrap",
      ["User ID", "Email", "Display Name", "Day", "Completed IDs", "Order IDs", "Updated"],
      rows
    );
    setStatus(`Loaded ${data.states?.length ?? 0} state rows`);
  } catch (error) {
    setStatus(`User state load failed: ${error.message}`, true);
  }
}

async function loadAudit() {
  readConnectionInputs();
  setStatus("Loading audit...");
  try {
    const data = await api("/admin/audit?limit=100");
    const rows = (data.entries || []).map(
      (entry) => `
        <tr>
          <td>${escapeHtml(entry.id)}</td>
          <td>${escapeHtml(entry.action)}</td>
          <td>${escapeHtml(entry.adminEmail || entry.adminUserId || "-")}</td>
          <td>${escapeHtml(entry.targetType || "-")}</td>
          <td>${escapeHtml(entry.targetId || "-")}</td>
          <td><code>${escapeHtml(JSON.stringify(entry.details || {}))}</code></td>
          <td>${formatDate(entry.createdAt)}</td>
        </tr>
      `
    );
    renderTable(
      "auditTableWrap",
      ["ID", "Action", "Admin", "Target Type", "Target ID", "Details", "Created"],
      rows
    );
    setStatus(`Loaded ${data.entries?.length ?? 0} audit entries`);
  } catch (error) {
    setStatus(`Audit load failed: ${error.message}`, true);
  }
}

function bindEvents() {
  $("connectBtn").addEventListener("click", connect);
  $("searchUsersBtn").addEventListener("click", loadUsers);
  $("loadOverridesBtn").addEventListener("click", loadOverrides);
  $("loadAllowBtn").addEventListener("click", loadAllowlist);
  $("addAllowBtn").addEventListener("click", upsertAllowlist);
  $("loadStateBtn").addEventListener("click", loadUserState);
  $("loadAuditBtn").addEventListener("click", loadAudit);

  $("usersTableWrap").addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const row = target.closest("tr[data-user-id]");
    if (!row) return;
    const userId = row.dataset.userId;
    if (!userId) return;
    const select = row.querySelector('[data-role="tier-select"]');
    const reasonInput = row.querySelector('[data-role="tier-reason"]');
    if (!select || !reasonInput) return;

    try {
      if (target.dataset.action === "save-tier") {
        await saveTierOverride(userId, select.value, reasonInput.value.trim());
        setStatus(`Tier override saved for ${userId}`);
      } else if (target.dataset.action === "remove-tier") {
        await removeTierOverride(userId);
        setStatus(`Tier override removed for ${userId}`);
      }
      await Promise.all([loadUsers(), loadOverrides()]);
    } catch (error) {
      setStatus(`Tier action failed: ${error.message}`, true);
    }
  });

  $("allowlistTableWrap").addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-action='remove-admin']");
    if (!target) return;
    const userId = target.dataset.userId;
    if (!userId) return;
    try {
      await removeAdmin(userId);
      setStatus(`Admin removed for ${userId}`);
      await loadAllowlist();
    } catch (error) {
      setStatus(`Allowlist remove failed: ${error.message}`, true);
    }
  });
}

bindEvents();
