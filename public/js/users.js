let currentUserId = null;


function getInitials(name) {

    if (!name) {
        return "";
    }

    const parts = name.trim().split(/\s+/);

    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";

    return (first + last).toUpperCase();
}


function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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

    currentUserId = me.id;

    renderHeader(me);

    if (me.role !== "Administrator") {
        document.getElementById("accessDenied").classList.remove("hidden");
        return;
    }

    document.getElementById("usersContent").classList.remove("hidden");

    await loadUsers();
}


async function loadUsers() {

    const response = await fetch("/api/admin/users");

    if (!response.ok) {
        alert("Unable to load users.");
        return;
    }

    renderUsers(await response.json());
}


function renderUsers(users) {

    document.getElementById("usersTable").innerHTML = users.map(user => {

        const isSelf = user.id === currentUserId;
        const isAdminUser = user.role === "Administrator";

        const actions = isSelf
            ? `<span class="muted-label">You</span>`
            : `
                <div class="alert-actions">

                    <button class="action-button edit-button"
                            onclick="changeRole('${user.id}', '${isAdminUser ? "User" : "Administrator"}')">
                        ${isAdminUser ? "Make User" : "Make Admin"}
                    </button>

                    ${user.active
                        ? `<button class="action-button cancel-button"
                                   onclick="setActive('${user.id}', false)">Deactivate</button>`
                        : `<button class="action-button reactivate-button"
                                   onclick="setActive('${user.id}', true)">Reactivate</button>`}

                </div>
            `;

        return `
            <tr>
                <td data-label="Name"><strong>${escapeHtml(user.name)}</strong></td>
                <td data-label="Email">${escapeHtml(user.email)}</td>
                <td data-label="Role"><span class="status ${isAdminUser ? "role-admin" : "role-user"}">${escapeHtml(user.role)}</span></td>
                <td data-label="Subsidiary">${user.subsidiary ? escapeHtml(user.subsidiary) : "All subsidiaries"}</td>
                <td data-label="Status"><span class="status ${user.active ? "status-completed" : "status-cancelled"}">${user.active ? "Active" : "Inactive"}</span></td>
                <td data-label="Action">${actions}</td>
            </tr>
        `;

    }).join("");
}


async function updateUser(id, changes, confirmMessage) {

    if (confirmMessage && !confirm(confirmMessage)) {
        return;
    }

    const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes)
    });

    if (!response.ok) {

        const data = await response.json().catch(() => ({}));

        alert(data.message || "Unable to update user.");

        return;
    }

    await loadUsers();
}


function changeRole(id, role) {

    updateUser(
        id,
        { role },
        role === "Administrator"
            ? "Make this person an Administrator? They will be able to see and manage alerts across all subsidiaries."
            : "Remove this person's Administrator access?"
    );
}


function setActive(id, active) {

    updateUser(
        id,
        { active },
        active
            ? null
            : "Deactivate this person? They will no longer be able to sign in or be assigned as an owner."
    );
}


init();
