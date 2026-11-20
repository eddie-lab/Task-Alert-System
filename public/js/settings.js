let isUserAdmin = false;

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


function getInitials(name) {

    if (!name) {
        return "";
    }

    const parts = name.trim().split(/\s+/);

    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";

    return (first + last).toUpperCase();
}


function renderHeader(me) {

    document.getElementById("userAvatar").textContent = getInitials(me.name);
    document.getElementById("userName").textContent = me.name;

    document.getElementById("userRole").textContent =
        me.role === "Administrator" ? "Administrator" : me.subsidiary;

    const display = me.role === "Administrator" ? "block" : "none";

    document.getElementById("adminNav").style.display = display;
    document.getElementById("allAlertsNav").style.display = display;
    if (me.role === "Administrator") loadDeliveryProblemCount();
}

function loadDeliveryProblemCount() {
    fetch("/api/admin/delivery-problems")
        .then(response => response.ok ? response.json() : [])
        .then(problems => {
            const count = document.getElementById("deliveryProblemsCount");
            count.textContent = problems.length;
            document.getElementById("deliveryProblemsNav").classList.toggle("has-delivery-problems", problems.length > 0);
        })
        .catch(error => console.error("Unable to load delivery problem count:", error));
}


async function init() {

    const meResponse = await fetch("/api/users/me");
    const me = await meResponse.json();

    renderHeader(me);

    isUserAdmin = me.role === "Administrator";

    if (!isUserAdmin) {
        document.getElementById("accessDenied").classList.remove("hidden");
        return;
    }

    document.getElementById("settingsContent").classList.remove("hidden");

    await loadEmailTemplates();
    await loadDomains();
}


/* ============ EMAIL TEMPLATES ============ */

async function loadEmailTemplates() {

    const response = await fetch("/api/settings/email-templates");
    const templates = await response.json();

    document.getElementById("reminderSubject").value = templates.reminder.subject;
    document.getElementById("reminderBody").value = templates.reminder.body;
    document.getElementById("dueDateSubject").value = templates.dueDate ? templates.dueDate.subject : "";
    document.getElementById("dueDateBody").value = templates.dueDate ? templates.dueDate.body : "";
    document.getElementById("escalationSubject").value = templates.escalation.subject;
    document.getElementById("escalationBody").value = templates.escalation.body;
}


async function saveEmailTemplates() {

    const payload = {
        reminder: {
            subject: document.getElementById("reminderSubject").value,
            body: document.getElementById("reminderBody").value
        },
        escalation: {
            subject: document.getElementById("escalationSubject").value,
            body: document.getElementById("escalationBody").value
        },
        dueDate: {
            subject: document.getElementById("dueDateSubject").value,
            body: document.getElementById("dueDateBody").value
        }
    };

    const response = await fetch("/api/settings/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const data = await response.json();
        alert(data.message || "Unable to save email templates.");
        return;
    }

    const msg = document.getElementById("templatesSavedMsg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2000);
}


/* ============ SUBSIDIARY DOMAINS ============ */

async function loadDomains() {

    const response = await fetch("/api/settings/subsidiary-domains");
    const domainMap = await response.json();

    const container = document.getElementById("domainRows");
    container.innerHTML = "";

    Object.entries(domainMap).forEach(([domain, value]) => {
        addDomainRow(domain, value);
    });
}


function addDomainRow(domain = "", value = "") {

    const isAmbiguous = value && typeof value === "object";

    const row = document.createElement("div");
    row.className = "domain-row";
    

    row.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>Domain</label>
                <input class="domain-name" value="${escapeHtml(domain)}" placeholder="example.com">
            </div>
            <div class="form-group">
                <label>Type</label>
                <select class="domain-type" onchange="toggleDomainType(this)">
                    <option value="single" ${!isAmbiguous ? "selected" : ""}>Single subsidiary</option>
                    <option value="ambiguous" ${isAmbiguous ? "selected" : ""}>Multiple - ask which one</option>
                </select>
            </div>
        </div>

        <div class="single-fields" style="${isAmbiguous ? "display:none;" : ""}">
            <div class="form-group">
                <label>Subsidiary</label>
                <input class="domain-subsidiary" value="${!isAmbiguous ? escapeHtml(value) : ""}" placeholder="Norrenberger Pension">
            </div>
        </div>

        <div class="ambiguous-fields" style="${isAmbiguous ? "" : "display:none;"}">
            <div class="form-group">
                <label>Question to ask at signup</label>
                <input class="domain-question" value="${isAmbiguous ? escapeHtml(value.question) || "" : ""}" placeholder="Which subsidiary are you part of?">
            </div>
            <div class="form-group">
                <label>Options (comma separated)</label>
                <input class="domain-options" value="${isAmbiguous ? escapeHtml((value.options || []).join(", ")) : ""}" placeholder="Subsidiary A, Subsidiary B">
            </div>
        </div>

        <button type="button" class="secondary-button" onclick="this.closest('.domain-row').remove()">
            Remove
        </button>
    `;

    document.getElementById("domainRows").appendChild(row);
}


function toggleDomainType(select) {

    const row = select.closest(".domain-row");
    const isAmbiguous = select.value === "ambiguous";

    row.querySelector(".single-fields").style.display = isAmbiguous ? "none" : "";
    row.querySelector(".ambiguous-fields").style.display = isAmbiguous ? "" : "none";
}


function collectDomainMap() {

    const domainMap = {};

    document.querySelectorAll(".domain-row").forEach(row => {

        const domain = row.querySelector(".domain-name").value.trim().toLowerCase();

        if (!domain) {
            return;
        }

        const type = row.querySelector(".domain-type").value;

        if (type === "single") {

            domainMap[domain] = row.querySelector(".domain-subsidiary").value.trim();

        } else {

            const options = row.querySelector(".domain-options").value
                .split(",")
                .map(option => option.trim())
                .filter(Boolean);

            domainMap[domain] = {
                ambiguous: true,
                question: row.querySelector(".domain-question").value.trim(),
                options
            };
        }
    });

    return domainMap;
}


async function saveDomains() {

    const domainMap = collectDomainMap();

    const response = await fetch("/api/settings/subsidiary-domains", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(domainMap)
    });

    if (!response.ok) {
        const data = await response.json();
        alert(data.message || "Unable to save domain rules.");
        return;
    }

    const msg = document.getElementById("domainsSavedMsg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2000);
}


init();
