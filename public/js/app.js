let allAlerts = [];
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
// DISPLAY ALERTS
// ==============================

function renderAlerts(alerts) {

    const table =
        document.getElementById("alertsTable");

    table.innerHTML = "";

    //empty table message
    if (!alerts.length) {
        table.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:24px">No alerts match this filter.</td></tr>`;
        return;
    }

    alerts.forEach(alert => {

        const row =
            document.createElement("tr");

        const statusClass =
            alert.status
                .toLowerCase()
                .replace(/\s+/g, "-");

        row.innerHTML = `

            <td>
                <strong>${escapeHtml(alert.name)}</strong>
                <br>
                <small>
                    ${escapeHtml(alert.description)}
                </small>
            </td>

            <td>
                ${escapeHtml(alert.subsidiary)}
            </td>

            <td>
                ${escapeHtml(alert.owner)}
            </td>

            <td>
                ${formatDate(alert.dueDate)}
            </td>

            <td>
                Every ${escapeHtml(alert.frequencyValue)}
                ${escapeHtml(alert.frequencyUnit)}
            </td>

            <td>

                <span class="status status-${statusClass}">
                    ${escapeHtml(alert.status)}
                </span>

            </td>

            <td>
                <div class="alert-actions">

                    ${
                        alert.status === "Cancelled"

                        ?

                        `
                        <button
                            class="action-button edit-button"
                            onclick="editAlert('${alert.id}')">
                            Edit
                        </button>

                        <button
                            class="action-button reactivate-button"
                            onclick="reactivateAlert('${alert.id}')">
                            Reactivate
                        </button>
                        `

                        :

                        alert.status === "Completed"

                        ?

                        `
                        <span class="completed-label">
                            ✓ Completed
                        </span>
                        `

                        :

                        `
                        <button
                            class="action-button edit-button"
                            onclick="editAlert('${alert.id}')">
                            Edit
                        </button>

                        <button
                            class="action-button complete-button"
                            onclick="completeAlert('${alert.id}')">
                            Done
                        </button>

                        <button
                            class="action-button cancel-button"
                            onclick="cancelAlert('${alert.id}')">
                            Cancel
                        </button>
                        `
                    }

                </div>
            </td>

        `;

        table.appendChild(row);

    });
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


    const filtered =
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


            return (
                matchesSearch &&
                matchesSubsidiary &&
                matchesStatus &&
                cardMatches(alert)
            );

        });


    renderAlerts(filtered);
}


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