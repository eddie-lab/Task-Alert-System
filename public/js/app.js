let allAlerts = [];
let visibleAlerts = [];
let currentUser = null;

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}




// LOAD CURRENT USER and collaborator recipients

let assignableUsers = [];
let manualRecipients = [];
let selectedCollaboratorIds = new Set();


function parseEmailList(value) {

    return value
        .split(",")
        .map(email => email.trim())
        .filter(Boolean);
}


function getAutoRecipientEmails() {

    const emails = [];

    if (currentUser && currentUser.email) {
        emails.push(currentUser.email);
    }

    selectedCollaboratorIds.forEach(id => {
        const user = assignableUsers.find(candidate => candidate.id === id);

        if (user && user.email) {
            emails.push(user.email);
        }
    });

    return [...new Set(emails)];
}


function syncRecipientsField() {

    const merged = [...new Set([
        ...getAutoRecipientEmails(),
        ...manualRecipients
    ])];

    document.getElementById("recipients").value = merged.join(", ");
}

const CARD_FILTER_LABELS = {
    active: "Total Active",
    dueToday: "Due Today",
    overdue: "Overdue",
    escalated: "Escalated",
    completed: "Completed"
};

document.querySelectorAll(".stat-card[data-filter]").forEach(card => {

    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const toggle = () => {
        const f = card.dataset.filter;
        const wasSelected = cardFilter === f;

        clearCardFilter();
        document.getElementById("statusFilter").value = "";

        if (!wasSelected) {
            cardFilter = f;
            card.classList.add("selected");
        }

        filterAlerts();
        updateActiveFilterBar();

        // On mobile, scroll the alerts table into view after filtering
        if (window.matchMedia("(max-width: 700px)").matches) {
            const target = document.getElementById("alertsSection")
                || document.querySelector(".table-container");
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    };

    card.addEventListener("click", toggle);
    card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
        }
    });
});

async function loadCurrentUser() {

    const response = await fetch("/api/users/me");

    currentUser = await response.json();

    renderCurrentUserHeader();

    await loadAssignableUsers();
}


async function loadAssignableUsers() {

    const response = await fetch("/api/users/assignable");

    assignableUsers = await response.json();

    const search = document.getElementById("collaboratorSearch");
    const container = document.getElementById("alertOwnerOptions");

    search.addEventListener("input", renderCollaboratorPicker);
    container.addEventListener("click", event => {
        const addButton = event.target.closest("[data-add-collaborator]");
        const removeButton = event.target.closest("[data-remove-collaborator]");

        if (addButton) {
            selectedCollaboratorIds.add(addButton.dataset.addCollaborator);
            search.value = "";
            renderCollaboratorPicker();
            search.focus();
            syncRecipientsField();
        } else if (removeButton) {
            selectedCollaboratorIds.delete(removeButton.dataset.removeCollaborator);
            renderCollaboratorPicker();
            syncRecipientsField();
        }
    });

    renderCollaboratorPicker();
}

function renderCollaboratorPicker() {
    const query = document.getElementById("collaboratorSearch").value.trim().toLowerCase();
    const selectedContainer = document.getElementById("collaboratorSelected");
    const resultsContainer = document.getElementById("collaboratorResults");

    selectedContainer.innerHTML = [...selectedCollaboratorIds]
        .map(id => assignableUsers.find(user => user.id === id))
        .filter(Boolean)
        .map(user => `
            <span class="collaborator-chip">
                ${escapeHtml(user.name)}
                <button type="button"
                    data-remove-collaborator="${escapeHtml(user.id)}"
                    aria-label="Remove ${escapeHtml(user.name)}">×</button>
            </span>
        `)
        .join("");

    const matches = query ? assignableUsers
        .filter(user => !selectedCollaboratorIds.has(user.id))
        .filter(user => `${user.name} ${user.email} ${user.subsidiary || ""}`
            .toLowerCase()
            .includes(query))
        .slice(0, 8) : [];

    resultsContainer.innerHTML = matches.length
        ? matches.map(user => `
            <button type="button"
                class="collaborator-option"
                data-add-collaborator="${escapeHtml(user.id)}"
                role="option">
                <span>${escapeHtml(user.name)}</span>
                <small>${escapeHtml(user.email)}</small>
            </button>
        `).join("")
        : `<p class="collaborator-empty">${query ? "No matching collaborators." : "Search by name or email to add a collaborator."}</p>`;
}
document.getElementById("recipients").addEventListener("input", () => {

    const currentAuto = getAutoRecipientEmails();

    manualRecipients = parseEmailList(
        document.getElementById("recipients").value
    ).filter(email => !currentAuto.includes(email));
});


// RENDER CURRENT USER IN HEADER


function getInitials(name) {

    if (!name) {
        return "";
    }

    const parts = name.trim().split(/\s+/);

    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";

    return (first + last).toUpperCase();
}

//sidebar by subsidairy
function renderCurrentUserHeader() {

    if (!currentUser) {
        return;
    }

    updateDashboardHeader();

    document.getElementById("userAvatar").textContent =
        getInitials(currentUser.name);

    document.getElementById("userName").textContent =
        currentUser.name;

    // Administrators aren't tied to one subsidiary, 
    document.getElementById("userRole").textContent =
        currentUser.role === "Administrator"
            ? "Administrator"
            : currentUser.subsidiary;

    // Administration tools (Subsidiaries, Users, System Settings) 
    document.getElementById("adminNav").style.display =
        currentUser.role === "Administrator"
            ? "block"
            : "none";
    //all alerts for admin only

    document.getElementById("allAlertsNav").style.display =
        currentUser.role === "Administrator"
            ? "block"
            : "none";

    applySubsidiaryControls();
}

function updateDashboardHeader() {
    if (!currentUser) {
        return;
    }

    const now = new Date();
    const firstName = String(currentUser.name || "").trim().split(/\s+/)[0];
    const greeting = now.getHours() < 12
        ? "Good morning"
        : now.getHours() < 18
            ? "Good afternoon"
            : "Good evening";

    document.getElementById("dashboardGreeting").textContent =
        `${greeting}, ${firstName || "there"}`;

    const dateTime = document.getElementById("dashboardDateTime");
    dateTime.dateTime = now.toISOString();
    dateTime.textContent = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(now);
}

// SUBSIDIARY FILTERS
// Both roles can filter the alerts visible to them by subsidiary.

function applySubsidiaryControls() {

    const listFilter = document.getElementById("subsidiaryFilter");
    const dashSelect = document.getElementById("dashboardSubsidiary");
    const dashWrap = document.getElementById("dashboardSubsidiaryWrap");

    // copy the subsidiary options into the dashboard switcher once
    if (dashSelect.options.length <= 1) {
        Array.from(listFilter.options)
            .filter(option => option.value.trim() !== "")
            .forEach(o => {
                const opt = document.createElement("option");
                opt.value = o.value || o.text.trim();
                opt.textContent = o.text.trim();
                dashSelect.appendChild(opt);
            });
    }

    dashWrap.style.display = "flex";
    listFilter.style.display = "";
}

function onSubsidiaryChange(value) {

    if (!currentUser) {
        return;
    }

    // keep both switchers in sync
    document.getElementById("subsidiaryFilter").value = value;
    document.getElementById("dashboardSubsidiary").value = value;

    loadDashboard();
    filterAlerts();
}

// LOCK SUBSIDIARY TO CURRENT USER


function applyCurrentUserSubsidiary() {

    const subsidiarySelect =
        document.getElementById("alertSubsidiary");

    if (!currentUser) {
        return;
    }

    if (currentUser.role === "Administrator") {

        subsidiarySelect.disabled = false;
        return;
    }

    // Regular users always create alerts under their own subsidiary.
    subsidiarySelect.value = currentUser.subsidiary;
    subsidiarySelect.disabled = true;
}

// OPEN CREATE ALERT (FRESH FORM)


function openNewAlertForm() {

    const form = document.getElementById("alertForm");

    delete form.dataset.editingId;

    document.getElementById("alertModalTitle").textContent =
        "Create Alert";

    document.getElementById("alertSubmitButton").textContent =
        "Create Alert";

    form.reset();

    manualRecipients = [];
    selectedCollaboratorIds.clear();
    document.getElementById("collaboratorSearch").value = "";
    renderCollaboratorPicker();

    applyCurrentUserSubsidiary();

    syncRecipientsField();
    setBatchImportVisible(true);
    clearBatchImportResult();

    openCreateAlert();
}


// ==============================
// LOAD DASHBOARD
// ==============================

async function loadDashboard() {

    const dashSub = document.getElementById("dashboardSubsidiary").value;

    const response = await fetch(
        "/api/dashboard" +
        (dashSub ? "?subsidiary=" + encodeURIComponent(dashSub) : "")
    );

    const data = await response.json();

    document.getElementById("totalAlerts").textContent =
        data.total;

    document.getElementById("dueToday").textContent =
        data.dueToday;

    document.getElementById("overdue").textContent =
        data.overdue;

    document.getElementById("escalated").textContent =
        data.escalated;

    document.getElementById("completed").textContent =
        data.completed;
}


// ==============================
// LOAD ALERTS
// ==============================

async function loadAlerts() {

    const response =
        await fetch("/api/alerts");

    allAlerts = await response.json();

    filterAlerts();
}


// ==============================
// MOBILE CARDS + ACTIONS MENU
// ==============================

const expandedAlertIds = new Set();
const mobileQuery = window.matchMedia("(max-width: 700px)");

// Tap a card (mobile only) to expand / collapse its details.
document.addEventListener("click", event => {

    if (!mobileQuery.matches) {
        return;
    }

    const cell = event.target.closest("#alertsTable td:first-child");

    if (!cell) {
        return;
    }

    const row = cell.closest("tr.alert-row");

    if (!row) {
        return;
    }

    const open = row.classList.toggle("expanded");

    if (open) {
        expandedAlertIds.add(row.dataset.id);
    } else {
        expandedAlertIds.delete(row.dataset.id);
    }

    const toggle = row.querySelector(".card-toggle");

    if (toggle) {
        toggle.setAttribute("aria-expanded", String(open));
    }
});

function alertActionItems(alert) {

    const items = [];

    if (alert.status === "Cancelled") {
        items.push({ label: "Edit", run: () => editAlert(alert.id) });
        items.push({ label: "Reactivate", run: () => reactivateAlert(alert.id) });
    } else if (alert.status !== "Completed") {
        items.push({ label: "Edit", run: () => editAlert(alert.id) });
        items.push({ label: "Mark as done", run: () => completeAlert(alert.id) });
        items.push({ label: "Cancel alert", run: () => cancelAlert(alert.id) });
    }

    items.push({
        label: "Delete",
        danger: true,
        run: () => deleteAlert(alert.id)
    });

    return items;
}

function closeAlertActions() {

    const existing = document.getElementById("alertActionsMenu");

    if (existing) {
        existing.remove();
    }

    document.removeEventListener("keydown", onActionsKeydown);
}

function onActionsKeydown(event) {

    if (event.key === "Escape") {
        closeAlertActions();
    }
}

// Bottom sheet on mobile, small dropdown anchored to the button on desktop.
function openAlertActions(id, trigger) {

    closeAlertActions();

    const target = allAlerts.find(a => a.id === id);

    if (!target) {
        return;
    }

    const backdrop = document.createElement("div");

    backdrop.id = "alertActionsMenu";
    backdrop.className = "actions-backdrop";

    const menu = document.createElement("div");

    menu.className = "actions-menu";
    menu.setAttribute("role", "menu");

    const title = document.createElement("div");

    title.className = "actions-menu__title";
    title.textContent = target.name;
    menu.appendChild(title);

    alertActionItems(target).forEach(item => {

        const button = document.createElement("button");

        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.className =
            "actions-menu__item" + (item.danger ? " actions-menu__item--danger" : "");
        button.textContent = item.label;

        button.addEventListener("click", () => {
            closeAlertActions();
            item.run();
        });

        menu.appendChild(button);
    });

    const close = document.createElement("button");

    close.type = "button";
    close.className = "actions-menu__close";
    close.textContent = "Close";
    close.addEventListener("click", closeAlertActions);
    menu.appendChild(close);

    backdrop.appendChild(menu);

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            closeAlertActions();
        }
    });

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onActionsKeydown);

    if (!mobileQuery.matches && trigger) {

        const rect = trigger.getBoundingClientRect();
        const menuHeight = menu.offsetHeight;
        const below = window.innerHeight - rect.bottom;
        const top = below >= menuHeight + 8
            ? rect.bottom + 4
            : Math.max(8, rect.top - menuHeight - 4);

        menu.style.top = `${top}px`;
        menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    }

    const first = menu.querySelector(".actions-menu__item");

    if (first) {
        first.focus();
    }
}


// ==============================
// DISPLAY ALERTS
// ==============================

function renderAlerts(alerts) {

    const table =
        document.getElementById("alertsTable");

    table.innerHTML = "";

    //empty table message
    if (!alerts.length) {
        table.innerHTML = `<tr><td colspan="7" class="table-empty">No alerts match this filter.</td></tr>`;
        return;
    }

    alerts.forEach(alert => {

        const row =
            document.createElement("tr");

        const statusClass =
            alert.status
                .toLowerCase()
                .replace(/\s+/g, "-");

        const completedMeta = alert.status === "Completed"
            ? completionMetaHtml(alert)
            : "";

        const isExpanded = expandedAlertIds.has(alert.id);

        row.className = "alert-row" + (isExpanded ? " expanded" : "");
        row.dataset.id = alert.id;

        const actionsHtml = `
                        <button
                            type="button"
                            class="action-button actions-trigger"
                            aria-haspopup="menu"
                            onclick="openAlertActions('${alert.id}', this)">
                            Actions <span aria-hidden="true">▾</span>
                        </button>
                    `;

        row.innerHTML = `

            <td data-label="Alert">
                <button
                    type="button"
                    class="card-toggle"
                    aria-expanded="${isExpanded}"
                    aria-label="Show or hide details for ${escapeHtml(alert.name)}">
                    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <strong>${escapeHtml(alert.name)}</strong>
                <br>
                <small>
                    ${escapeHtml(alert.description || "")}
                </small>
            </td>

            <td data-label="Subsidiary">
                ${escapeHtml(alert.subsidiary || "—")}
            </td>

            <td data-label="Collaborator(s)">
                ${escapeHtml(alert.owner || "—")}
            </td>

            <td data-label="Due Date">
                ${alert.dueDate ? formatDate(alert.dueDate) : "—"}
            </td>

            <td data-label="Frequency">
                Every ${escapeHtml(String(alert.frequencyValue ?? ""))}
                ${escapeHtml(alert.frequencyUnit || "")}
            </td>

            <td data-label="Status">
                <div class="status-cell">
                    <span class="status status-${statusClass}">
                        ${escapeHtml(alert.status)}
                    </span>
                    ${alert.status === "Completed" ? completedMeta : ""}
                </div>
            </td>

            <td data-label="Action">
                <div class="alert-actions">
                    ${actionsHtml}
                </div>
            </td>

        `;

        table.appendChild(row);

    });
}

/** Who marked the alert done, and when — for the status/action cells. */
function completionMetaHtml(alert) {
    const by = alert.completedBy ? escapeHtml(alert.completedBy) : "Unknown";
    const when = alert.completedDate ? formatDate(alert.completedDate) : "—";
    return `
        <div class="completion-meta" title="Completed by ${by} on ${when}">
            <span class="completion-meta__by">by ${by}</span>
            <span class="completion-meta__when">${when}</span>
        </div>
    `;
}
// filter alerts on stat card click
let cardFilter = "";

function isOpenAlert(a) {
    return a.status !== "Completed" && a.status !== "Cancelled";
}

function cardMatches(a) {
    switch (cardFilter) {
        case "active":    return isOpenAlert(a) || a.status === "Post-Due Reminder Sent";
        case "dueToday":  return isOpenAlert(a) && a.dueDate &&
                            new Date(a.dueDate).toDateString() === new Date().toDateString();
        case "overdue":   return isOpenAlert(a) && a.dueDate && new Date(a.dueDate) < new Date();
        case "escalated": return a.status === "Escalated";
        case "completed": return a.status === "Completed";
        default:          return true;
    }
}

function clearCardFilter() {
    cardFilter = "";
    document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("selected"));
    updateActiveFilterBar();
}

function updateActiveFilterBar() {
    const bar = document.getElementById("activeFilterBar");
    const text = document.getElementById("activeFilterText");
    if (!bar || !text) return;

    if (cardFilter && CARD_FILTER_LABELS[cardFilter]) {
        text.textContent = CARD_FILTER_LABELS[cardFilter];
        bar.classList.remove("hidden");
    } else {
        bar.classList.add("hidden");
        text.textContent = "";
    }
}


// ==============================
// FILTER ALERTS
// ==============================

function filterAlerts() {

    const search =
        document
            .getElementById("searchInput")
            .value
            .toLowerCase();

    const subsidiary = document.getElementById("subsidiaryFilter").value;

    const status =
        document
            .getElementById("statusFilter")
            .value;

    const fromDate = document.getElementById("dateFrom").value;
    const toDate = document.getElementById("dateTo").value;
    const dateRangeError = document.getElementById("dateRangeError");
    const dateRangeHelp = document.getElementById("dateRangeHelp");
    const downloadButton = document.getElementById("downloadAlertsBtn");

    if (fromDate && toDate && fromDate > toDate) {
        dateRangeError.textContent = "The start date must be on or before the end date.";
        dateRangeError.classList.remove("hidden");
        downloadButton.disabled = true;
        dateRangeHelp.textContent = "";
        visibleAlerts = [];
        renderAlerts(visibleAlerts);
        return;
    }

    dateRangeError.textContent = "";
    dateRangeError.classList.add("hidden");
    downloadButton.disabled = !fromDate || !toDate;
    dateRangeHelp.textContent = !fromDate && !toDate
        ? "Choose a start and end date to enable CSV download."
        : !fromDate
            ? "Choose a start date to enable CSV download."
            : !toDate
                ? "Choose an end date to enable CSV download."
                : "";

    visibleAlerts =
        allAlerts.filter(alert => {

            const matchesSearch =
                alert.name
                    .toLowerCase()
                    .includes(search);


            const matchesSubsidiary =
                !subsidiary ||
                alert.subsidiary === subsidiary;


            const isOverdue =
                alert.dueDate &&
                new Date(alert.dueDate) < new Date() &&
                alert.status !== "Completed" &&
                alert.status !== "Cancelled" &&
                alert.status === "Post-Due Reminder Sent";

            const matchesStatus =
                !status ||
                (status === "Overdue" ? isOverdue : alert.status === status);

            const dueDate = alert.dueDate ? String(alert.dueDate).slice(0, 10) : "";
            const matchesDateRange =
                (!fromDate || (dueDate && dueDate >= fromDate)) &&
                (!toDate || (dueDate && dueDate <= toDate));

            return (
                matchesSearch &&
                matchesSubsidiary &&
                matchesStatus &&
                matchesDateRange &&
                cardMatches(alert)
            );

        });


    renderAlerts(visibleAlerts);
}

function downloadFilteredAlerts() {
    if (document.getElementById("downloadAlertsBtn").disabled) {
        return;
    }

    const csvCell = value => {
        let text = String(value ?? "");
        if (/^[=+\-@\t\r]/.test(text)) {
            text = "'" + text;
        }
        return `"${text.replace(/"/g, '""')}"`;
    };

    const rows = [
        ["Alert", "Description", "Company", "Collaborators", "Due Date", "Frequency", "Status"],
        ...visibleAlerts.map(alert => [
            alert.name,
            alert.description,
            alert.subsidiary,
            alert.owner,
            alert.dueDate ? formatDate(alert.dueDate) : "",
            `Every ${alert.frequencyValue ?? ""} ${alert.frequencyUnit || ""}`.trim(),
            alert.status
        ])
    ];

    const csv = "\uFEFF" + rows
        .map(row => row.map(csvCell).join(","))
        .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "alerts.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

document.getElementById("downloadAlertsBtn")
    .addEventListener("click", downloadFilteredAlerts);


// ==============================
// CREATE ALERT MODAL
// ==============================

function openCreateAlert() {

    document
        .getElementById("alertModal")
        .classList
        .remove("hidden");
}


function closeCreateAlert() {

    document
        .getElementById("alertModal")
        .classList
        .add("hidden");
    clearBatchImportResult();
    const fileInput = document.getElementById("alertImportFile");
    if (fileInput) fileInput.value = "";
}


// ==============================
// CREATE ALERT
// ==============================

document
    .getElementById("alertForm")
    .addEventListener("submit", async function (event) {

        event.preventDefault();


        const dueDate =
            document
                .getElementById("dueDate")
                .value;

        const dueTime =
            document
                .getElementById("dueTime")
                .value;

                //prevent past due date and time
        const dueDateTime = new Date(`${dueDate}T${dueTime}`);
        if (dueDateTime <= new Date()) {
            alert("The due date and time cannot be in the past.");
            return;
        }


        const recipients =
            document
                .getElementById("recipients")
                .value
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);


        const escalationRecipients =
            document
                .getElementById("escalationRecipients")
                .value
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);


        const alertData = {

            name:
                document
                    .getElementById("alertName")
                    .value,

            description:
                document
                    .getElementById("alertDescription")
                    .value,

            subsidiary:
                document
                    .getElementById("alertSubsidiary")
                    .value,

            owner: [...selectedCollaboratorIds]
                .map(id => assignableUsers.find(user => user.id === id))
                .filter(Boolean)
                .map(user => user.name)
                .join(", "),
            ownerUserIds: [...selectedCollaboratorIds],


            frequencyValue:
                Number(
                    document
                        .getElementById("frequencyValue")
                        .value
                ),

            frequencyUnit:
                document
                    .getElementById("frequencyUnit")
                    .value,

            dueDate:
                `${dueDate}T${dueTime}`,

            reminderValue:
                Number(
                    document
                        .getElementById("reminderValue")
                        .value
                ),

            reminderUnit:
                document
                    .getElementById("reminderUnit")
                    .value,

            reminderRepeatValue:
                Number(
                    document
                        .getElementById("reminderRepeatValue")
                        .value
                ) || 0,

            reminderRepeatUnit:
                document
                    .getElementById("reminderRepeatUnit")
                    .value,

            escalationEnabled:
                document
                    .getElementById("escalationEnabled")
                    .checked,

            escalationValue:
                Number(
                    document
                        .getElementById("escalationValue")
                        .value
                ),

            escalationUnit:
                document
                    .getElementById("escalationUnit")
                    .value,

            recipients,

            escalationRecipients

        };


        const form = document.getElementById("alertForm");

        const editingId = form.dataset.editingId;

        const url = editingId
            ? `/api/alerts/${editingId}`
            : "/api/alerts";

        const method = editingId
            ? "PUT"
            : "POST";

        const response = await fetch(url, {

            method: method,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(alertData)

        });


        if (!response.ok) {

            const errorData =
                await response.json().catch(() => ({}));

            alert(
                errorData.message ||
                "Unable to create alert."
            );

            return;
        }


        closeCreateAlert();

        form.reset();

        delete form.dataset.editingId;

        await loadAlerts();
        await loadDashboard();

        alert(
            editingId
                ? "Alert updated successfully."
                : "Alert created successfully."
        );

    });


// COMPLETE ALERT

async function completeAlert(id) {

    const confirmed =
        confirm(
            "Mark this alert as completed?"
        );


    if (!confirmed) {
        return;
    }


    const response =
        await fetch(
            `/api/alerts/${id}/complete`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({})
            }
        );


        if (!response.ok) {

                const errorData =
                    await response.json().catch(() => ({}));

                alert(
                    errorData.message ||
                    "Unable to complete alert."
                );

                return;
        }


    await loadAlerts();

    alert(
        "Alert marked as completed."
    );
}


// ==============================
// EDIT ALERT
// ==============================

async function editAlert(id) {

    try {

        const response =
            await fetch(`/api/alerts/${id}`);

        if (!response.ok) {

            alert("Unable to load alert.");

            return;
        }

        const alertData =
            await response.json();

        const form =
            document.getElementById("alertForm");

        // Store the ID so submit knows this is an edit
        form.dataset.editingId =
            alertData.id;

        setBatchImportVisible(false);
        clearBatchImportResult();

        document.getElementById("alertName").value =
            alertData.name || "";

        document.getElementById("alertDescription").value =
            alertData.description || "";

        document.getElementById("alertSubsidiary").disabled = false;

        document.getElementById("alertSubsidiary").value =
            alertData.subsidiary || "";

        const ownerIds = alertData.ownerUserIds || [];
        selectedCollaboratorIds = new Set(
            ownerIds.filter(id => assignableUsers.some(user => user.id === id))
        );
        document.getElementById("collaboratorSearch").value = "";
        renderCollaboratorPicker();
        const automaticRecipients = new Set(
            getAutoRecipientEmails().map(email => email.toLowerCase())
        );
        manualRecipients = (alertData.recipients || [])
            .filter(email => typeof email === "string" &&
                !automaticRecipients.has(email.toLowerCase()));
        syncRecipientsField();

        const dueDate =
            new Date(alertData.dueDate);

        document.getElementById("dueDate").value =
            dueDate.toISOString().split("T")[0];

        document.getElementById("dueTime").value =
            dueDate.toTimeString().substring(0, 5);

        document.getElementById("frequencyValue").value =
            alertData.frequencyValue || 1;

        document.getElementById("frequencyUnit").value =
            alertData.frequencyUnit || "month";

        document.getElementById("reminderValue").value =
            alertData.reminderValue || 24;

        document.getElementById("reminderUnit").value =
            alertData.reminderUnit || "hour";

        document.getElementById("reminderRepeatValue").value =
            alertData.reminderRepeatValue || 0;

        document.getElementById("reminderRepeatUnit").value =
            alertData.reminderRepeatUnit || "minute";

        document.getElementById("escalationEnabled").checked =
            alertData.escalationEnabled || false;

        document.getElementById("escalationValue").value =
            alertData.escalationValue || 1;

        document.getElementById("escalationUnit").value =
            alertData.escalationUnit || "hour";

        document.getElementById("recipients").value =
            (alertData.recipients || []).join(", ");

        document.getElementById("escalationRecipients").value =
            (alertData.escalationRecipients || []).join(", ");

        // Change modal title and button
        document.getElementById("alertModalTitle").textContent =
            "Edit Alert";

        document.getElementById("alertSubmitButton").textContent =
            "Save Changes";

        // Open modal
        openCreateAlert();

    } catch (error) {

        console.error("Edit alert error:", error);

        alert("Unable to load alert.");
    }
}

// ==============================
// CANCEL ALERT
// ==============================

async function cancelAlert(id) {

    const confirmed =
        confirm(
            "Are you sure you want to cancel this alert?"
        );

    if (!confirmed) {
        return;
    }

    const response =
        await fetch(
            `/api/alerts/${id}/deactivate`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                })
            }
        );

        if (!response.ok) {

                const errorData =
                    await response.json().catch(() => ({}));

                alert(
                    errorData.message ||
                    "Unable to cancel alert."
                );

            return;
        }

    await loadAlerts();
    await loadDashboard();

    alert(
        "Alert cancelled successfully."
    );
}


// ==============================
// DELETE ALERT
// ==============================

async function deleteAlert(id) {

    const target = allAlerts.find(a => a.id === id);

    const confirmed =
        confirm(
            `Delete this alert?\n\n"${target ? target.name : "This alert"}" will be permanently removed. This can't be undone.`
        );

    if (!confirmed) {
        return;
    }

    const response =
        await fetch(
            `/api/alerts/${id}`,
            { method: "DELETE" }
        );

    if (!response.ok) {

        const errorData =
            await response.json().catch(() => ({}));

        alert(
            errorData.message ||
            "Unable to delete alert."
        );

        return;
    }

    expandedAlertIds.delete(id);

    await loadAlerts();
    await loadDashboard();

    alert(
        "Alert deleted."
    );
}


// ==============================
// REACTIVATE ALERT
// ==============================

async function reactivateAlert(id) {

    const confirmed =
        confirm(
            "Are you sure you want to reactivate this alert?"
        );

    if (!confirmed) {
        return;
    }

    const response =
        await fetch(
            `/api/alerts/${id}/reactivate`,
            {
                method: "POST"
            }
        );

        if (!response.ok) {

                const errorData =
                    await response.json().catch(() => ({}));

                alert(
                    errorData.message ||
                    "Unable to reactivate alert."
                );

                return;
        }

    await loadAlerts();
    await loadDashboard();

    alert(
        "Alert reactivated successfully."
    );
}


// ==============================
// BATCH IMPORT (Excel template)
// ==============================

function setBatchImportVisible(visible) {
    const panel = document.getElementById("batchImportPanel");
    const divider = document.getElementById("singleAlertDivider");
    if (panel) panel.hidden = !visible;
    if (divider) divider.hidden = !visible;
}

function clearBatchImportResult() {
    const box = document.getElementById("batchImportResult");
    if (!box) return;
    box.hidden = true;
    box.className = "batch-import__result";
    box.innerHTML = "";
}

function showBatchImportResult(payload) {
    const box = document.getElementById("batchImportResult");
    if (!box) return;
    const created = payload.created || [];
    const failed = payload.failed || [];
    box.hidden = false;
    let tone = "is-bad";
    if (created.length && failed.length) tone = "is-mixed";
    else if (created.length) tone = "is-ok";
    box.className = "batch-import__result " + tone;

    let html = `<p><strong>${escapeHtml(payload.message || "")}</strong></p>`;
    if (created.length) {
        html += `<p class="batch-import__ok-count">${created.length} created</p>`;
    }
    if (failed.length) {
        html += `<ul class="batch-import__errors">`;
        failed.slice(0, 12).forEach((item) => {
            html += `<li>Row ${item.row}: ${escapeHtml(item.error || "Invalid")}</li>`;
        });
        if (failed.length > 12) {
            html += `<li>…and ${failed.length - 12} more</li>`;
        }
        html += `</ul>`;
    }
    box.innerHTML = html;
}

async function downloadAlertTemplate() {
    try {
        const response = await fetch("/api/alerts/template");
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            alert(err.message || "Unable to download the template.");
            return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "alert-import-template.xlsx";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(error);
        alert("Unable to download the template.");
    }
}

async function importAlertTemplate(file) {
    if (!file) return;

    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".xlsx")) {
        showBatchImportResult({
            message: "Upload an Excel .xlsx file (download the template first).",
            created: [],
            failed: []
        });
        return;
    }

    const body = new FormData();
    body.append("file", file);

    const resultBox = document.getElementById("batchImportResult");
    if (resultBox) {
        resultBox.hidden = false;
        resultBox.className = "batch-import__result";
        resultBox.innerHTML = "<p><strong>Importing…</strong></p>";
    }

    try {
        const response = await fetch("/api/alerts/import", {
            method: "POST",
            body
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && !(payload.created && payload.created.length)) {
            showBatchImportResult({
                message: payload.message || "Import failed.",
                created: payload.created || [],
                failed: payload.failed || []
            });
            return;
        }
        showBatchImportResult(payload);
        if (payload.created && payload.created.length) {
            await loadDashboard();
            await loadAlerts();
        }
    } catch (error) {
        console.error(error);
        showBatchImportResult({
            message: "Unable to import alerts.",
            created: [],
            failed: []
        });
    }
}

document.getElementById("downloadAlertTemplateBtn")?.addEventListener("click", downloadAlertTemplate);
document.getElementById("alertImportFile")?.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    importAlertTemplate(file).finally(() => {
        event.target.value = "";
    });
});

// ==============================
// DATE FORMAT
// ==============================

function formatDate(date) {

    return new Date(date)
        .toLocaleString(
            "en-GB",
            {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }
        );
}


loadCurrentUser();
loadDashboard();
loadAlerts();
setInterval(updateDashboardHeader, 60_000);

// ==============================
// INFO (i) BUTTONS: hidden hints that open on click
// ==============================

document.addEventListener("click", event => {

    const button = event.target.closest(".info-toggle");

    if (!button) {
        return;
    }

    const panel =
        document.getElementById(button.getAttribute("aria-controls"));

    if (!panel) {
        return;
    }

    const opening = panel.hidden;

    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
});
