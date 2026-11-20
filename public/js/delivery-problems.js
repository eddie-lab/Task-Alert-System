const table = document.getElementById("deliveryProblemsTable");
const message = document.getElementById("deliveryProblemsMessage");

function safeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
}

function displayDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
}

async function loadDeliveryProblems() {
    const response = await fetch("/api/admin/delivery-problems");
    if (response.status === 401) {
        window.location.replace("/signup.html");
        return;
    }
    if (response.status === 403) {
        window.location.replace("/");
        return;
    }
    if (!response.ok) throw new Error("Unable to load delivery problems.");
    const problems = await response.json();
    document.getElementById("deliveryProblemsCount").textContent = problems.length;
    table.innerHTML = problems.length ? problems.map(problem => `
        <tr>
            <td data-label="Recipient">${safeText(problem.recipient || "—")}</td>
            <td data-label="Title"><strong>${safeText(problem.title || problem.subject || "—")}</strong><small class="delivery-problem-meta">${safeText(problem.category || "")}${problem.error ? ` · ${safeText(problem.error)}` : ""}</small></td>
            <td data-label="Due date">${safeText(displayDate(problem.dueDate))}</td>
            <td data-label="Action"><div class="delivery-problem-actions"><button class="action-button complete-button" data-action="resend" data-id="${safeText(problem.id)}">Resend</button><button class="action-button delete-button" data-action="discard" data-id="${safeText(problem.id)}">Discard</button></div></td>
        </tr>`).join("") : '<tr><td colspan="4" class="table-empty">No delivery problems.</td></tr>';
}

document.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    button.disabled = true;
    message.textContent = button.dataset.action === "resend" ? "Resending email..." : "Discarding email...";
    try {
        const response = await fetch(`/api/admin/delivery-problems/${encodeURIComponent(button.dataset.id)}${button.dataset.action === "resend" ? "/resend" : ""}`, {
            method: button.dataset.action === "resend" ? "POST" : "DELETE"
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Action failed.");
        message.textContent = result.message || "Done.";
        await loadDeliveryProblems();
    } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
        await loadDeliveryProblems().catch(() => {});
    }
});

fetch("/api/users/me").then(response => response.json()).then(user => {
    if (user.role !== "Administrator") return window.location.replace("/");
    document.getElementById("userName").textContent = user.name || "Administrator";
    document.getElementById("userRole").textContent = user.role;
    const names = String(user.name || "").trim().split(/\s+/);
    document.getElementById("userAvatar").textContent = ((names[0] || "")[0] || "") + (names.length > 1 ? names[names.length - 1][0] : "");
    loadDeliveryProblems().catch(error => {
        message.textContent = error.message;
        table.innerHTML = '<tr><td colspan="4" class="table-empty">Delivery problems could not be loaded.</td></tr>';
    });
}).catch(() => window.location.replace("/signup.html"));
