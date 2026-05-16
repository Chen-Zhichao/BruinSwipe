const STORAGE_KEY = "swipe-wallet-state-v1";
const CLOUD_BACKUP_KEY = "swipe-wallet-last-cloud-state-v1";
const DEFAULT_SWIPE_PRICE = 12.5;
const DEFAULT_DEVELOPER_QUOTE = "Swipe first, settle later, audit always. - Zhichao Chen";
const MANAGER_DISPLAY_BALANCE = 100;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const weekday = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
});

let state = createEmptyState();
let requests = [];
let cloudStore = null;
let visibleWeekStart = getWeekStart(new Date());
let toastTimer = null;
let authSubscription = null;

const els = {
  balancesBody: document.querySelector("#balances-body"),
  membersBody: document.querySelector("#members-body"),
  requestsBody: document.querySelector("#requests-body"),
  ledgerBody: document.querySelector("#ledger-body"),
  mealMembers: document.querySelector("#meal-members"),
  weekGrid: document.querySelector("#week-grid"),
  weekRange: document.querySelector("#week-range"),
  totalBalance: document.querySelector("#metric-total-balance"),
  weekSwipes: document.querySelector("#metric-week-swipes"),
  lowBalances: document.querySelector("#metric-low-balances"),
  members: document.querySelector("#metric-members"),
  developerQuote: document.querySelector("#developer-quote"),
  quoteForm: document.querySelector("#quote-form"),
  quoteInput: document.querySelector("#quote-input"),
  mealForm: document.querySelector("#meal-form"),
  topupForm: document.querySelector("#topup-form"),
  memberForm: document.querySelector("#member-form"),
  requestForms: Array.from(document.querySelectorAll("[data-request-form]")),
  requestMealMembers: document.querySelector("#request-meal-members"),
  requestTopupPerson: document.querySelector("#request-topup-person"),
  requestTopupDate: document.querySelector("#request-topup-date"),
  requestMealDate: document.querySelector("#request-meal-date"),
  requestMealPrice: document.querySelector("#request-meal-price"),
  adminLoginForm: document.querySelector("#admin-login-form"),
  adminSignIn: document.querySelector("#admin-sign-in"),
  adminSignInLabel: document.querySelector("#admin-sign-in-label"),
  adminLogout: document.querySelector("#admin-logout"),
  syncStatus: document.querySelector("#sync-status"),
  mealDate: document.querySelector("#meal-date"),
  mealPrice: document.querySelector("#meal-price"),
  topupDate: document.querySelector("#topup-date"),
  topupPerson: document.querySelector("#topup-person"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  resetData: document.querySelector("#reset-data"),
  previousWeek: document.querySelector("#previous-week"),
  currentWeek: document.querySelector("#current-week"),
  nextWeek: document.querySelector("#next-week"),
  toast: document.querySelector("#toast"),
};

bindEvents();
initializeApp();

function bindEvents() {
  els.memberForm.addEventListener("submit", handleAddMember);
  els.quoteForm.addEventListener("submit", handleQuoteSave);
  els.topupForm.addEventListener("submit", handleTopup);
  els.mealForm.addEventListener("submit", handleMeal);
  els.requestForms.forEach((form) => {
    form.addEventListener("submit", handleSubmitRequest);
  });
  els.adminLoginForm.addEventListener("submit", handleAdminLogin);
  els.adminLogout.addEventListener("click", handleAdminLogout);
  els.exportData.addEventListener("click", exportState);
  els.importData.addEventListener("change", importState);
  els.resetData.addEventListener("click", resetState);
  els.previousWeek.addEventListener("click", () => changeWeek(-7));
  els.currentWeek.addEventListener("click", () => {
    visibleWeekStart = getWeekStart(new Date());
    render();
  });
  els.nextWeek.addEventListener("click", () => changeWeek(7));

  els.ledgerBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-transaction]");
    if (!button) return;
    deleteTransaction(button.dataset.deleteTransaction);
  });

  els.balancesBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-person]");
    if (!button) return;
    deletePerson(button.dataset.deletePerson);
  });

  els.membersBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-person]");
    if (!button) return;
    deletePerson(button.dataset.deletePerson);
  });

  els.requestsBody.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-member-request]");
    const approveButton = event.target.closest("[data-approve-request]");
    const rejectButton = event.target.closest("[data-reject-request]");

    if (editButton) {
      editMemberRequest(editButton.dataset.editMemberRequest);
      return;
    }

    if (approveButton) {
      approveRequest(approveButton.dataset.approveRequest);
      return;
    }

    if (rejectButton) {
      rejectRequest(rejectButton.dataset.rejectRequest);
    }
  });
}

async function initializeApp() {
  resetDefaultDates();
  cloudStore = createCloudStore();

  if (!cloudStore) {
    state = loadLocalState();
    updateAccessMode();
    updateSyncStatus("Local mode", "local");
    render();
    return;
  }

  document.body.classList.add("cloud-mode");
  updateAccessMode();
  updateSyncStatus("Connecting", "local");
  await refreshSession();
  await loadCloudState();
  await loadRequests();
  subscribeToCloudState();
  subscribeToRequests();
  render();
}

function createCloudStore() {
  const config = window.SWIPEWALLET_SUPABASE;
  if (!config || !config.url || !config.anonKey || !window.supabase?.createClient) {
    return null;
  }

  return {
    adminEmail: config.adminEmail ? String(config.adminEmail).toLowerCase() : "",
    channel: null,
    client: window.supabase.createClient(config.url, config.anonKey),
    requestChannel: null,
    session: null,
    walletId: config.walletId || "main",
  };
}

async function refreshSession() {
  if (!cloudStore) return;

  const { data, error } = await cloudStore.client.auth.getSession();
  if (error) {
    updateSyncStatus("Auth unavailable", "error");
    showToast(error.message);
    return;
  }

  cloudStore.session = data.session;
  updateAccessMode();

  if (!authSubscription) {
    const { data: listener } = cloudStore.client.auth.onAuthStateChange(async (_event, session) => {
      cloudStore.session = session;
      updateAccessMode();
      await loadRequests();
      subscribeToRequests();
      render();
    });
    authSubscription = listener.subscription;
  }
}

async function loadCloudState() {
  if (!cloudStore) return;

  const { data, error } = await cloudStore.client
    .from("wallet_state")
    .select("data")
    .eq("id", cloudStore.walletId)
    .maybeSingle();

  if (error) {
    updateSyncStatus("Cloud load failed", "error");
    state = loadCloudBackup();
    showToast(error.message);
    return;
  }

  state = data?.data ? normalizeState(data.data) : createEmptyState();
  saveCloudBackup();
  updateAccessMode();
  updateSyncStatus(canEdit() ? "Cloud sync on" : "Read-only cloud", canEdit() ? "online" : "read-only");
}

function subscribeToCloudState() {
  if (!cloudStore || cloudStore.channel) return;

  cloudStore.channel = cloudStore.client
    .channel(`wallet_state:${cloudStore.walletId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "wallet_state",
        filter: `id=eq.${cloudStore.walletId}`,
      },
      (payload) => {
        if (!payload.new?.data) return;
        state = normalizeState(payload.new.data);
        saveCloudBackup();
        render();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        updateSyncStatus(
          canEdit() ? "Cloud sync on" : "Read-only cloud",
          canEdit() ? "online" : "read-only",
        );
      }
    });
}

async function loadRequests() {
  if (!cloudStore || !canEdit()) {
    requests = [];
    return;
  }

  const { data, error } = await cloudStore.client
    .from("wallet_requests")
    .select("id,type,payload,created_at")
    .eq("wallet_id", cloudStore.walletId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    requests = [];
    showToast(error.message);
    return;
  }

  requests = data || [];
}

function subscribeToRequests() {
  if (!cloudStore || cloudStore.requestChannel || !canEdit()) return;

  cloudStore.requestChannel = cloudStore.client
    .channel(`wallet_requests:${cloudStore.walletId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "wallet_requests",
        filter: `wallet_id=eq.${cloudStore.walletId}`,
      },
      async () => {
        await loadRequests();
        render();
      },
    )
    .subscribe();
}

async function handleAdminLogin(event) {
  event.preventDefault();
  if (!cloudStore) return;

  setAdminSignInLoading(true);
  const { error } = await cloudStore.client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.href.split("#")[0],
    },
  });

  if (error) {
    setAdminSignInLoading(false);
    showToast(error.message);
    return;
  }
}

async function handleAdminLogout() {
  if (!cloudStore) return;
  await cloudStore.client.auth.signOut();
  cloudStore.session = null;
  updateAccessMode();
  render();
  showToast("Signed out.");
}

async function handleAddMember(event) {
  event.preventDefault();
  if (!ensureCanEdit()) return;

  const formData = new FormData(event.currentTarget);
  const name = String(formData.get("name") || "").trim();
  const contact = String(formData.get("contact") || "").trim();
  const role = formData.get("isOrganizer") === "on" ? "organizer" : "member";

  if (!name) {
    showToast("Enter a member name.");
    return;
  }

  const exists = state.people.some(
    (person) => person.name.toLowerCase() === name.toLowerCase(),
  );
  if (exists) {
    showToast("That member already exists.");
    return;
  }

  const nextState = cloneState(state);
  nextState.people.push({
    id: createId("person"),
    name,
    contact,
    role,
    createdAt: new Date().toISOString(),
  });

  resetForm(event.currentTarget);
  await commitState(nextState, "Member added.");
}

async function handleQuoteSave(event) {
  event.preventDefault();
  if (!ensureCanEdit()) return;

  const formData = new FormData(event.currentTarget);
  const quote = String(formData.get("quote") || "").trim();

  if (!quote) {
    showToast("Enter a quote.");
    return;
  }

  const nextState = cloneState(state);
  nextState.settings.quote = quote.slice(0, 140);
  await commitState(nextState, "Quote saved.");
}

async function handleTopup(event) {
  event.preventDefault();
  if (!ensureCanEdit()) return;

  const formData = new FormData(event.currentTarget);
  const personId = String(formData.get("personId") || "");
  const amount = Number(formData.get("amount"));
  const date = String(formData.get("date") || todayKey());
  const note = String(formData.get("note") || "").trim();

  if (!personId || !getBillablePeople().some((person) => person.id === personId)) {
    showToast("Choose a paying member.");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a positive top-up amount.");
    return;
  }

  const nextState = cloneState(state);
  nextState.transactions.push({
    id: createId("txn"),
    personId,
    type: "topup",
    date,
    amount: roundMoney(amount),
    description: note || "Top-up",
    createdAt: new Date().toISOString(),
  });

  resetForm(event.currentTarget);
  resetDefaultDates();
  await commitState(nextState, "Top-up recorded.");
}

async function handleMeal(event) {
  event.preventDefault();
  if (!ensureCanEdit()) return;

  const formData = new FormData(event.currentTarget);
  const date = String(formData.get("date") || todayKey());
  const mealName = String(formData.get("mealName") || "Meal");
  const price = Number(formData.get("price"));
  const note = String(formData.get("note") || "").trim();
  const selectedPeople = Array.from(
    els.mealMembers.querySelectorAll("input[type='checkbox']:checked"),
  ).map((input) => input.value);

  if (!Number.isFinite(price) || price < 0) {
    showToast("Enter a non-negative swipe price.");
    return;
  }

  if (selectedPeople.length === 0) {
    showToast("Select at least one member.");
    return;
  }

  const nextState = cloneState(state);
  nextState.settings.swipePrice = roundMoney(price);

  selectedPeople.forEach((personId) => {
    const person = state.people.find((item) => item.id === personId);
    const isOrganizer = person?.role === "organizer";

    nextState.transactions.push({
      id: createId("txn"),
      personId,
      type: "meal",
      date,
      amount: isOrganizer ? 0 : roundMoney(-price),
      price: roundMoney(price),
      description: note || `${mealName} swipe`,
      mealName,
      createdAt: new Date().toISOString(),
    });
  });

  resetForm(event.currentTarget);
  resetDefaultDates();
  await commitState(
    nextState,
    `Recorded ${selectedPeople.length} swipe${selectedPeople.length === 1 ? "" : "s"}.`,
  );
}

async function handleSubmitRequest(event) {
  event.preventDefault();

  if (!cloudStore) {
    showToast("Requests require cloud mode.");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const type = String(formData.get("type") || "add_member");
  const note = String(formData.get("note") || "").trim();
  let payload = null;

  if (type === "add_member") {
    const name = String(formData.get("name") || "").trim();
    const contact = String(formData.get("contact") || "").trim();

    if (!name) {
      showToast("Enter your name.");
      return;
    }

    payload = { name, contact, note };
  }

  if (type === "topup") {
    const personId = String(formData.get("topupPersonId") || "");
    const amount = Number(formData.get("topupAmount"));
    const date = String(formData.get("topupDate") || todayKey());

    if (!getBillablePeople().some((person) => person.id === personId)) {
      showToast("Choose a member.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a positive top-up amount.");
      return;
    }

    payload = { personId, amount: roundMoney(amount), date, note };
  }

  if (type === "meal") {
    const date = String(formData.get("mealDate") || todayKey());
    const mealName = String(formData.get("mealName") || "Meal");
    const price = Number(formData.get("mealPrice"));
    const personIds = Array.from(
      els.requestMealMembers.querySelectorAll("input[type='checkbox']:checked"),
    ).map((input) => input.value);

    if (!Number.isFinite(price) || price < 0) {
      showToast("Enter a non-negative swipe price.");
      return;
    }

    if (personIds.length === 0) {
      showToast("Select at least one member.");
      return;
    }

    payload = { personIds, date, mealName, price: roundMoney(price), note };
  }

  const { error } = await cloudStore.client.from("wallet_requests").insert({
    wallet_id: cloudStore.walletId,
    type,
    payload,
  });

  if (error) {
    showToast(error.message);
    return;
  }

  resetForm(event.currentTarget);
  resetDefaultDates();
  showToast("Request submitted for admin approval.");
}

async function approveRequest(requestId) {
  if (!ensureCanEdit()) return;

  const request = requests.find((item) => item.id === requestId);
  if (!request) return;

  const nextState = cloneState(state);
  const result = applyRequestToState(nextState, request);

  if (!result.ok) {
    showToast(result.message);
    return;
  }

  const saved = await commitState(nextState, "Request approved.");
  if (!saved) return;

  await updateRequestStatus(requestId, "approved");
}

async function rejectRequest(requestId) {
  if (!ensureCanEdit()) return;
  if (!window.confirm("Reject this request?")) return;
  await updateRequestStatus(requestId, "rejected");
  showToast("Request rejected.");
}

async function editMemberRequest(requestId) {
  if (!ensureCanEdit()) return;

  const request = requests.find((item) => item.id === requestId);
  if (!request || request.type !== "add_member") return;

  const payload = request.payload || {};
  const currentName = String(payload.name || "").trim();
  const nextName = window.prompt("Edit member name", currentName);
  if (nextName === null) return;

  const name = nextName.trim();
  if (!name) {
    showToast("Enter a member name.");
    return;
  }

  const duplicate = state.people.some(
    (person) => person.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    showToast("That member already exists.");
    return;
  }

  const { error } = await cloudStore.client
    .from("wallet_requests")
    .update({
      payload: {
        ...payload,
        name,
      },
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) {
    showToast(error.message);
    return;
  }

  await loadRequests();
  render();
  showToast("Request name updated.");
}

async function updateRequestStatus(requestId, status) {
  const { error } = await cloudStore.client
    .from("wallet_requests")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: cloudStore.session?.user?.email || "",
    })
    .eq("id", requestId);

  if (error) {
    showToast(error.message);
    return;
  }

  await loadRequests();
  render();
}

function applyRequestToState(nextState, request) {
  const payload = request.payload || {};

  if (request.type === "add_member") {
    const name = String(payload.name || "").trim();
    const contact = String(payload.contact || "").trim();

    if (!name) return { ok: false, message: "Request has no name." };

    const exists = nextState.people.some(
      (person) => person.name.toLowerCase() === name.toLowerCase(),
    );
    if (exists) return { ok: false, message: "That member already exists." };

    nextState.people.push({
      id: createId("person"),
      name,
      contact,
      role: "member",
      createdAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  if (request.type === "topup") {
    const personId = String(payload.personId || "");
    const amount = Number(payload.amount);
    const date = String(payload.date || todayKey());
    const note = String(payload.note || "").trim();

    if (!nextState.people.some((person) => person.id === personId && person.role !== "organizer")) {
      return { ok: false, message: "Top-up member is missing." };
    }

    if (!Number.isFinite(amount) || amount <= 0 || !isDateKey(date)) {
      return { ok: false, message: "Top-up request is invalid." };
    }

    nextState.transactions.push({
      id: createId("txn"),
      personId,
      type: "topup",
      date,
      amount: roundMoney(amount),
      description: note || "Top-up",
      createdAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  if (request.type === "meal") {
    const personIds = Array.isArray(payload.personIds) ? payload.personIds.map(String) : [];
    const date = String(payload.date || todayKey());
    const mealName = String(payload.mealName || "Meal");
    const price = Number(payload.price);
    const note = String(payload.note || "").trim();

    if (!Number.isFinite(price) || price < 0 || !isDateKey(date) || personIds.length === 0) {
      return { ok: false, message: "Meal request is invalid." };
    }

    nextState.settings.swipePrice = roundMoney(price);

    personIds.forEach((personId) => {
      const person = nextState.people.find((item) => item.id === personId);
      if (!person) return;

      nextState.transactions.push({
        id: createId("txn"),
        personId,
        type: "meal",
        date,
        amount: person.role === "organizer" ? 0 : roundMoney(-price),
        price: roundMoney(price),
        description: note || `${mealName} swipe`,
        mealName,
        createdAt: new Date().toISOString(),
      });
    });

    return { ok: true };
  }

  return { ok: false, message: "Unknown request type." };
}

async function deleteTransaction(transactionId) {
  if (!ensureCanEdit()) return;

  const transaction = state.transactions.find((item) => item.id === transactionId);
  if (!transaction) return;
  if (!window.confirm("Delete this ledger entry?")) return;

  const nextState = cloneState(state);
  nextState.transactions = nextState.transactions.filter((item) => item.id !== transactionId);
  await commitState(nextState, "Ledger entry deleted.");
}

async function deletePerson(personId) {
  if (!ensureCanEdit()) return;

  const person = state.people.find((item) => item.id === personId);
  if (!person) return;

  const hasHistory = state.transactions.some((item) => item.personId === personId);
  if (hasHistory) {
    showToast("Members with ledger history cannot be deleted.");
    return;
  }

  const nextState = cloneState(state);
  nextState.people = nextState.people.filter((item) => item.id !== personId);
  await commitState(nextState, `${person.name} removed.`);
}

function changeWeek(dayDelta) {
  visibleWeekStart = addDays(visibleWeekStart, dayDelta);
  render();
}

function render() {
  const mealAwards = getMealAwardMap();
  const topupAwards = getTopupAwardMap();

  updateAccessMode();
  syncControls();
  renderSummary();
  renderBalances(mealAwards, topupAwards);
  renderMembers(mealAwards, topupAwards);
  renderRequests();
  renderWeek();
  renderLedger();
  refreshIcons();
}

function syncControls() {
  const billablePeople = getBillablePeople();
  const peopleOptions = billablePeople
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`)
    .join("");

  els.topupPerson.innerHTML = billablePeople.length
    ? peopleOptions
    : '<option value="">Add a paying member first</option>';
  els.topupPerson.disabled = billablePeople.length === 0;
  els.requestTopupPerson.innerHTML = billablePeople.length
    ? peopleOptions
    : '<option value="">No paying members yet</option>';
  els.requestTopupPerson.disabled = billablePeople.length === 0;

  const checkedIds = new Set(
    Array.from(els.mealMembers.querySelectorAll("input[type='checkbox']:checked")).map(
      (input) => input.value,
    ),
  );
  const requestCheckedIds = new Set(
    Array.from(els.requestMealMembers.querySelectorAll("input[type='checkbox']:checked")).map(
      (input) => input.value,
    ),
  );

  if (state.people.length === 0) {
    els.mealMembers.innerHTML = '<p class="empty-state">No members yet.</p>';
    els.requestMealMembers.innerHTML = '<p class="empty-state">No members yet.</p>';
  } else {
    const memberChecks = state.people
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((person, index) => {
        const roleTag =
          person.role === "organizer" ? '<span class="role-tag">organizer</span>' : "";

        return {
          id: person.id,
          label: `${escapeHtml(person.name)}${roleTag}`,
          sortIndex: index,
        };
      });

    els.mealMembers.innerHTML = memberChecks
      .map((person) => {
        const checked = checkedIds.has(person.id) ? "checked" : "";
        return `
          <label class="member-check">
            <input type="checkbox" value="${escapeHtml(person.id)}" ${checked} />
            <span>${person.label}</span>
          </label>
        `;
      })
      .join("");

    els.requestMealMembers.innerHTML = memberChecks
      .map((person) => {
        const checked = requestCheckedIds.has(person.id) ? "checked" : "";
        return `
          <label class="member-check">
            <input type="checkbox" value="${escapeHtml(person.id)}" ${checked} />
            <span>${person.label}</span>
          </label>
        `;
      })
      .join("");
  }

  if (!els.mealDate.value) els.mealDate.value = todayKey();
  if (!els.topupDate.value) els.topupDate.value = todayKey();
  if (!els.mealPrice.value) els.mealPrice.value = state.settings.swipePrice.toFixed(2);
  if (!els.requestTopupDate.value) els.requestTopupDate.value = todayKey();
  if (!els.requestMealDate.value) els.requestMealDate.value = todayKey();
  if (!els.requestMealPrice.value) els.requestMealPrice.value = state.settings.swipePrice.toFixed(2);
  els.developerQuote.textContent = state.settings.quote;
  if (document.activeElement !== els.quoteInput) {
    els.quoteInput.value = state.settings.quote;
  }
}

function renderSummary() {
  const balances = getBalanceRows();
  const weekStartKey = toDateKey(visibleWeekStart);
  const weekEndKey = toDateKey(addDays(visibleWeekStart, 6));
  const weekMeals = state.transactions.filter(
    (transaction) =>
      transaction.type === "meal" &&
      transaction.date >= weekStartKey &&
      transaction.date <= weekEndKey,
  );

  const totalBalance = balances.reduce((sum, row) => sum + row.balance, 0);
  const lowBalances = balances.filter(
    (row) => row.balance < state.settings.swipePrice,
  ).length;

  els.totalBalance.textContent = currency.format(totalBalance);
  els.weekSwipes.textContent = String(weekMeals.length);
  els.lowBalances.textContent = String(lowBalances);
  els.members.textContent = String(getBillablePeople().length);
}

function renderBalances(mealAwards = getMealAwardMap(), topupAwards = getTopupAwardMap()) {
  const rows = getBalanceRows({ includeOrganizers: true }).sort(
    (a, b) => a.balance - b.balance || a.name.localeCompare(b.name),
  );

  if (rows.length === 0) {
    els.balancesBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">No paying members yet.</td>
      </tr>
    `;
    return;
  }

  els.balancesBody.innerHTML = rows
    .map((row) => {
      const isOrganizer = row.role === "organizer";
      const status = isOrganizer
        ? { label: "Manager", className: "status-manager" }
        : getBalanceStatus(row.balance);
      const deleteButton =
        row.transactionCount === 0 && canEdit() && !isOrganizer
          ? `
            <button class="delete-row" type="button" title="Delete member" aria-label="Delete ${escapeHtml(row.name)}" data-delete-person="${escapeHtml(row.id)}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          `
          : "";

      return `
        <tr>
          <td>
            <div class="member-name-line">
              <strong>${escapeHtml(row.name)}</strong>
              ${isOrganizer ? '<span class="role-tag">manager</span>' : ""}
              ${renderTopupAwards(row.id, topupAwards)}
              ${renderMealAwards(row.id, mealAwards)}
            </div>
            ${!isOrganizer && row.contact ? `<div class="empty-state">${escapeHtml(row.contact)}</div>` : ""}
          </td>
          <td class="money ${row.balance < 0 ? "negative" : "positive"}">${currency.format(row.balance)}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
          <td>${row.lastActivity ? escapeHtml(formatDateLabel(row.lastActivity)) : "-"}</td>
          <td><div class="row-actions">${deleteButton}</div></td>
        </tr>
      `;
    })
    .join("");
}

function renderMembers(mealAwards = getMealAwardMap(), topupAwards = getTopupAwardMap()) {
  if (!els.membersBody) return;

  const people = state.people
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  if (people.length === 0) {
    els.membersBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">No members yet.</td>
      </tr>
    `;
    return;
  }

  els.membersBody.innerHTML = people
    .map((person) => {
      const transactionCount = state.transactions.filter(
        (transaction) => transaction.personId === person.id,
      ).length;
      const deleteControl =
        transactionCount === 0 && canEdit()
          ? `
            <button class="delete-row" type="button" title="Delete member" aria-label="Delete ${escapeHtml(person.name)}" data-delete-person="${escapeHtml(person.id)}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          `
          : '<span class="empty-state">Has ledger</span>';

      return `
        <tr>
          <td>
            <div class="member-name-line">
              <strong>${escapeHtml(person.name)}</strong>
              ${renderTopupAwards(person.id, topupAwards)}
              ${renderMealAwards(person.id, mealAwards)}
            </div>
          </td>
          <td>${person.role === "organizer" ? '<span class="role-tag">organizer</span>' : "member"}</td>
          <td>${person.role === "organizer" || !person.contact ? "-" : escapeHtml(person.contact)}</td>
          <td>${transactionCount}</td>
          <td><div class="row-actions">${deleteControl}</div></td>
        </tr>
      `;
    })
    .join("");
}

function renderRequests() {
  if (!els.requestsBody) return;

  if (requests.length === 0) {
    els.requestsBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">No pending requests.</td>
      </tr>
    `;
    return;
  }

  els.requestsBody.innerHTML = requests
    .map((request) => `
      <tr>
        <td>${escapeHtml(formatDateTimeLabel(request.created_at))}</td>
        <td><span class="type-pill type-${request.type === "topup" ? "topup" : "meal"}">${escapeHtml(getRequestTypeLabel(request.type))}</span></td>
        <td>${escapeHtml(getRequestDetails(request))}</td>
        <td>
          <div class="request-actions">
            ${renderRequestEditButton(request)}
            <button class="approve-row" type="button" title="Approve request" aria-label="Approve request" data-approve-request="${escapeHtml(request.id)}">
              <i data-lucide="check" aria-hidden="true"></i>
            </button>
            <button class="reject-row" type="button" title="Reject request" aria-label="Reject request" data-reject-request="${escapeHtml(request.id)}">
              <i data-lucide="x" aria-hidden="true"></i>
            </button>
          </div>
        </td>
      </tr>
    `)
    .join("");
}

function renderRequestEditButton(request) {
  if (request.type !== "add_member") return "";

  return `
    <button class="edit-row" type="button" title="Edit member name" aria-label="Edit member name" data-edit-member-request="${escapeHtml(request.id)}">
      <i data-lucide="pencil" aria-hidden="true"></i>
    </button>
  `;
}

function getRequestTypeLabel(type) {
  if (type === "add_member") return "Add member";
  if (type === "topup") return "Top-up";
  if (type === "meal") return "Meal";
  return "Request";
}

function getRequestDetails(request) {
  const payload = request.payload || {};

  if (request.type === "add_member") {
    return `Add ${payload.name || "Unknown"}${payload.contact ? ` (${payload.contact})` : ""}${payload.note ? ` - ${payload.note}` : ""}`;
  }

  if (request.type === "topup") {
    const person = state.people.find((item) => item.id === payload.personId);
    return `${person ? person.name : "Unknown"} +${currency.format(Number(payload.amount || 0))} on ${formatDateLabel(payload.date || todayKey())}${payload.note ? ` - ${payload.note}` : ""}`;
  }

  if (request.type === "meal") {
    const names = Array.isArray(payload.personIds)
      ? payload.personIds
          .map((personId) => state.people.find((item) => item.id === personId)?.name || "Unknown")
          .join(", ")
      : "Unknown";
    return `${payload.mealName || "Meal"} on ${formatDateLabel(payload.date || todayKey())}: ${names} x ${currency.format(Number(payload.price || 0))}${payload.note ? ` - ${payload.note}` : ""}`;
  }

  return "";
}

function renderWeek() {
  const weekEnd = addDays(visibleWeekStart, 6);
  els.weekRange.textContent = `${formatDateLabel(toDateKey(visibleWeekStart))} - ${formatDateLabel(
    toDateKey(weekEnd),
  )}`;

  const weekStartKey = toDateKey(visibleWeekStart);
  const weekEndKey = toDateKey(weekEnd);
  const weekMeals = state.transactions.filter(
    (transaction) =>
      transaction.type === "meal" &&
      transaction.date >= weekStartKey &&
      transaction.date <= weekEndKey,
  );

  const mealsByDate = new Map();
  weekMeals.forEach((transaction) => {
    if (!mealsByDate.has(transaction.date)) mealsByDate.set(transaction.date, []);
    mealsByDate.get(transaction.date).push(transaction);
  });

  els.weekGrid.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(visibleWeekStart, index);
    const dateKey = toDateKey(date);
    const meals = mealsByDate.get(dateKey) || [];
    const grouped = groupMeals(meals);
    const body = grouped.length
      ? grouped
          .map(
            (group) => `
              <div class="meal-chip">
                <strong>${escapeHtml(group.mealName)}</strong>
                <span>${escapeHtml(group.names.join(", "))}</span>
                <span>${group.count} x ${currency.format(group.price)}</span>
              </div>
            `,
          )
          .join("")
      : '<p class="empty-state">No swipes</p>';

    return `
      <article class="day-column">
        <div class="day-title">
          ${escapeHtml(weekday.format(date))}
          <span>${escapeHtml(shortDate.format(date))}</span>
        </div>
        ${body}
      </article>
    `;
  }).join("");
}

function renderLedger() {
  const rows = state.transactions
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });

  if (rows.length === 0) {
    els.ledgerBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No ledger entries yet.</td>
      </tr>
    `;
    return;
  }

  els.ledgerBody.innerHTML = rows
    .map((transaction) => {
      const person = state.people.find((item) => item.id === transaction.personId);
      const typeLabel = transaction.type === "topup" ? "Top-up" : "Meal";
      const typeClass = transaction.type === "topup" ? "type-topup" : "type-meal";
      const amountClass = transaction.amount < 0 ? "negative" : "positive";
      const deleteButton = canEdit()
        ? `
          <button class="delete-row" type="button" title="Delete entry" aria-label="Delete entry" data-delete-transaction="${escapeHtml(transaction.id)}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        `
        : "";

      return `
        <tr>
          <td>${escapeHtml(formatDateLabel(transaction.date))}</td>
          <td>${escapeHtml(person ? person.name : "Unknown")}</td>
          <td><span class="type-pill ${typeClass}">${typeLabel}</span></td>
          <td>${escapeHtml(transaction.description || "")}</td>
          <td class="money ${amountClass}">${currency.format(transaction.amount)}</td>
          <td><div class="row-actions">${deleteButton}</div></td>
        </tr>
      `;
    })
    .join("");
}

function getBalanceRows(options = {}) {
  const people = options.includeOrganizers ? state.people : getBillablePeople();

  return people.map((person) => {
    const transactions = state.transactions.filter((item) => item.personId === person.id);
    const isOrganizer = person.role === "organizer";
    const balance = isOrganizer
      ? MANAGER_DISPLAY_BALANCE
      : transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const lastActivity = transactions
      .map((transaction) => transaction.date)
      .sort((a, b) => b.localeCompare(a))[0];

    return {
      ...person,
      balance: roundMoney(balance),
      lastActivity,
      transactionCount: transactions.length,
    };
  });
}

function getBillablePeople() {
  return state.people.filter((person) => person.role !== "organizer");
}

function getMealAwardMap() {
  const eligibleIds = new Set(getBillablePeople().map((person) => person.id));
  const weekEnd = addDays(visibleWeekStart, 6);
  const monthStart = new Date(visibleWeekStart.getFullYear(), visibleWeekStart.getMonth(), 1);
  const monthEnd = new Date(visibleWeekStart.getFullYear(), visibleWeekStart.getMonth() + 1, 0);

  return {
    week: getTopMealCounts(toDateKey(visibleWeekStart), toDateKey(weekEnd), eligibleIds),
    month: getTopMealCounts(toDateKey(monthStart), toDateKey(monthEnd), eligibleIds),
  };
}

function getTopMealCounts(startKey, endKey, eligibleIds) {
  const counts = new Map();

  state.transactions.forEach((transaction) => {
    if (
      transaction.type !== "meal" ||
      !eligibleIds.has(transaction.personId) ||
      transaction.date < startKey ||
      transaction.date > endKey
    ) {
      return;
    }

    counts.set(transaction.personId, (counts.get(transaction.personId) || 0) + 1);
  });

  const topCount = Math.max(0, ...counts.values());
  if (topCount === 0) return new Map();

  const winners = new Map();
  counts.forEach((count, personId) => {
    if (count === topCount) winners.set(personId, count);
  });
  return winners;
}

function getTopupAwardMap() {
  const eligibleIds = new Set(getBillablePeople().map((person) => person.id));
  const totals = new Map();

  state.transactions.forEach((transaction) => {
    if (transaction.type !== "topup" || !eligibleIds.has(transaction.personId)) return;
    totals.set(transaction.personId, roundMoney((totals.get(transaction.personId) || 0) + transaction.amount));
  });

  const topAmount = Math.max(0, ...totals.values());
  if (topAmount === 0) return new Map();

  const winners = new Map();
  totals.forEach((amount, personId) => {
    if (amount === topAmount) winners.set(personId, amount);
  });
  return winners;
}

function renderTopupAwards(personId, topupAwards) {
  const amount = topupAwards.get(personId);
  if (!amount) return "";

  const title = `Most total top-ups: ${currency.format(amount)}`;
  return `
    <span class="diamond-badge" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
      <span aria-hidden="true">💎</span>
    </span>
  `;
}

function renderMealAwards(personId, mealAwards) {
  const weekCount = mealAwards.week.get(personId);
  const monthCount = mealAwards.month.get(personId);
  const badges = [];

  if (weekCount) {
    badges.push(renderAwardBadge("week", "🌭", "W", weekCount, "Most swipes this week"));
  }

  if (monthCount) {
    badges.push(renderAwardBadge("month", "🍔", "M", monthCount, "Most swipes this month"));
  }

  return badges.length ? `<span class="trophy-badges">${badges.join("")}</span>` : "";
}

function renderAwardBadge(scope, icon, label, count, title) {
  const safeTitle = `${title}: ${count}`;
  return `
    <span class="trophy-badge ${scope}" title="${escapeHtml(safeTitle)}" aria-label="${escapeHtml(safeTitle)}">
      <span class="award-icon" aria-hidden="true">${icon}</span>
      <span>${label} ${count}</span>
    </span>
  `;
}

function getBalanceStatus(balance) {
  if (balance < 0) return { label: "Owes you", className: "status-negative" };
  if (balance < state.settings.swipePrice) return { label: "Low", className: "status-low" };
  return { label: "Funded", className: "status-funded" };
}

function groupMeals(meals) {
  const groups = new Map();

  meals.forEach((transaction) => {
    const price = Number.isFinite(Number(transaction.price))
      ? Number(transaction.price)
      : Math.abs(transaction.amount);
    const key = `${transaction.mealName || "Meal"}-${price}`;
    const person = state.people.find((item) => item.id === transaction.personId);

    if (!groups.has(key)) {
      groups.set(key, {
        mealName: transaction.mealName || "Meal",
        price,
        count: 0,
        names: [],
      });
    }

    const group = groups.get(key);
    group.count += 1;
    group.names.push(person ? person.name : "Unknown");
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    names: group.names.sort((a, b) => a.localeCompare(b)),
  }));
}

function exportState() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `swipewallet-backup-${todayKey()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("Backup exported.");
}

async function importState(event) {
  if (!ensureCanEdit()) {
    event.target.value = "";
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  try {
    const imported = normalizeState(JSON.parse(await file.text()));
    const saved = await commitState(imported, "Backup imported.");
    if (saved) {
      resetDefaultDates();
      visibleWeekStart = getWeekStart(new Date());
    }
  } catch (error) {
    showToast("That file is not a valid SwipeWallet backup.");
  } finally {
    event.target.value = "";
  }
}

async function resetState() {
  if (!ensureCanEdit()) return;
  if (!window.confirm("Reset all members and ledger entries?")) return;

  await commitState(createEmptyState(), "Data reset.");
  resetDefaultDates();
}

async function commitState(nextState, successMessage) {
  const previousState = state;
  state = normalizeState(nextState);

  const saved = await saveState();
  if (!saved) {
    state = previousState;
    render();
    return false;
  }

  render();
  if (successMessage) showToast(successMessage);
  return true;
}

async function saveState() {
  if (!cloudStore) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  }

  if (!canEdit()) {
    showToast("Sign in as admin to edit.");
    return false;
  }

  const { error } = await cloudStore.client.from("wallet_state").upsert({
    id: cloudStore.walletId,
    data: state,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    updateSyncStatus("Cloud save failed", "error");
    showToast(error.message);
    return false;
  }

  saveCloudBackup();
  updateSyncStatus("Cloud sync on", "online");
  return true;
}

function loadLocalState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : createEmptyState();
  } catch (error) {
    return createEmptyState();
  }
}

function loadCloudBackup() {
  try {
    const raw = window.localStorage.getItem(CLOUD_BACKUP_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : createEmptyState();
  } catch (error) {
    return createEmptyState();
  }
}

function saveCloudBackup() {
  window.localStorage.setItem(CLOUD_BACKUP_KEY, JSON.stringify(state));
}

function normalizeState(value) {
  if (!value || !Array.isArray(value.people) || !Array.isArray(value.transactions)) {
    throw new Error("Invalid state shape");
  }

  const people = value.people
    .filter((person) => person && person.id && person.name)
    .map((person) => ({
      id: String(person.id),
      name: String(person.name).trim(),
      role: person.role === "organizer" ? "organizer" : "member",
      createdAt: person.createdAt || new Date().toISOString(),
      contact:
        person.role === "organizer"
          ? ""
          : person.contact
            ? String(person.contact).trim()
            : "",
    }));

  const peopleIds = new Set(people.map((person) => person.id));
  const transactions = value.transactions
    .filter(
      (transaction) =>
        transaction &&
        transaction.id &&
        peopleIds.has(String(transaction.personId)) &&
        ["topup", "meal"].includes(transaction.type) &&
        Number.isFinite(Number(transaction.amount)) &&
        isDateKey(transaction.date),
    )
    .map((transaction) => {
      const amount = roundMoney(Number(transaction.amount));
      const price = Number(transaction.price);

      return {
        id: String(transaction.id),
        personId: String(transaction.personId),
        type: transaction.type,
        date: transaction.date,
        amount,
        price: Number.isFinite(price)
          ? roundMoney(price)
          : transaction.type === "meal"
            ? Math.abs(amount)
            : undefined,
        description: transaction.description ? String(transaction.description).trim() : "",
        mealName: transaction.mealName ? String(transaction.mealName).trim() : undefined,
        createdAt: transaction.createdAt || new Date().toISOString(),
      };
    });

  const swipePrice = Number(value.settings && value.settings.swipePrice);
  const quoteText = value.settings?.quote ? String(value.settings.quote).trim() : "";
  const quote = quoteText ? quoteText.slice(0, 140) : DEFAULT_DEVELOPER_QUOTE;

  return {
    settings: {
      swipePrice: Number.isFinite(swipePrice) && swipePrice >= 0
        ? roundMoney(swipePrice)
        : DEFAULT_SWIPE_PRICE,
      quote,
    },
    people,
    transactions,
  };
}

function createEmptyState() {
  return {
    settings: {
      swipePrice: DEFAULT_SWIPE_PRICE,
      quote: DEFAULT_DEVELOPER_QUOTE,
    },
    people: [],
    transactions: [],
  };
}

function resetDefaultDates() {
  els.mealDate.value = todayKey();
  els.topupDate.value = todayKey();
  els.mealPrice.value = state.settings.swipePrice.toFixed(2);
  els.requestTopupDate.value = todayKey();
  els.requestMealDate.value = todayKey();
  els.requestMealPrice.value = state.settings.swipePrice.toFixed(2);
}

function resetForm(form) {
  form.reset();
  form.querySelectorAll("input[type='text'], input[type='email'], input[type='number']").forEach((input) => {
    input.value = "";
  });
  form.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
}

function canEdit() {
  if (!cloudStore) return true;
  if (!cloudStore.session?.user?.email) return false;
  if (!cloudStore.adminEmail) return true;
  return cloudStore.session.user.email.toLowerCase() === cloudStore.adminEmail;
}

function ensureCanEdit() {
  if (canEdit()) return true;
  showToast("This shared page is read-only. Sign in as admin to edit.");
  return false;
}

function updateAccessMode() {
  const cloudMode = Boolean(cloudStore);
  const editMode = canEdit();

  document.body.classList.toggle("cloud-mode", cloudMode);
  document.body.classList.toggle("admin-mode", cloudMode && editMode);
  document.body.classList.toggle("read-only", cloudMode && !editMode);

  if (!cloudMode) {
    updateSyncStatus("Local mode", "local");
    return;
  }

  updateSyncStatus(editMode ? "Cloud sync on" : "Read-only cloud", editMode ? "online" : "read-only");
}

function updateSyncStatus(message, tone) {
  els.syncStatus.textContent = message;
  els.syncStatus.className = "sync-chip";
  if (tone && tone !== "local") {
    els.syncStatus.classList.add(tone);
  }
}

function setAdminSignInLoading(isLoading) {
  if (!els.adminSignIn || !els.adminSignInLabel) return;
  els.adminSignIn.disabled = isLoading;
  els.adminSignInLabel.textContent = isLoading ? "Opening Google" : "Sign in with Google";
}

function cloneState(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function todayKey() {
  return toDateKey(new Date());
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStart(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const mondayOffset = (day + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function formatDateLabel(dateKey) {
  return shortDate.format(parseDateKey(dateKey));
}

function formatDateTimeLabel(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "-";
  return `${shortDate.format(date)} ${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2600);
}
