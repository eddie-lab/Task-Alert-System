const test = require("node:test");
const assert = require("node:assert/strict");

const { validateAlertInput } = require("../services/alertValidation");
const {
    isOverdueAlert,
    getVisibleDashboardAlerts
} = require("../services/dashboardService");
const {
    calculateNextDueDate,
    calculateReminderDate
} = require("../services/alertSchedulingService");
const { renderTemplate } = require("../services/templateService");

function validAlert(overrides = {}) {
    return {
        name: "Monthly reconciliation",
        description: "Complete the monthly reconciliation.",
        subsidiary: "Example subsidiary",
        ownerUserIds: [],
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        frequencyValue: 1,
        frequencyUnit: "month",
        reminderValue: 24,
        reminderUnit: "hour",
        reminderRepeatValue: 0,
        reminderRepeatUnit: "minute",
        escalationEnabled: false,
        escalationValue: 2,
        escalationUnit: "hour",
        recipients: ["owner@example.com"],
        escalationRecipients: [],
        ...overrides
    };
}

test("validates and normalizes alert input", async () => {
    const result = await validateAlertInput(validAlert({
        name: "  Monthly reconciliation  ",
        recipients: [" owner@example.com ", "owner@example.com"]
    }));

    assert.equal(result.error, undefined);
    assert.equal(result.value.name, "Monthly reconciliation");
    assert.deepEqual(result.value.recipients, ["owner@example.com"]);
});

test("rejects invalid alert dates and recipient addresses", async () => {
    assert.match(
        (await validateAlertInput(validAlert({ dueDate: "not a date" }))).error,
        /due date/i
    );
    assert.match(
        (await validateAlertInput(validAlert({ recipients: ["not-an-email"] }))).error,
        /valid recipient email/i
    );
});

test("rejects repeats without an initial reminder", async () => {
    const result = await validateAlertInput(validAlert({
        reminderValue: 0,
        reminderRepeatValue: 10
    }));

    assert.match(result.error, /reminder is required/i);
});

test("counts overdue live alerts but not future escalations or completed alerts", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const overdue = dueDate => ({
        active: true,
        status: "Pending",
        dueDate
    });

    assert.equal(isOverdueAlert(overdue("2026-10-20T11:00:00.000Z"), now), true);
    assert.equal(isOverdueAlert({
        ...overdue("2026-10-20T13:00:00.000Z"),
        status: "Escalated"
    }, now), false);
    assert.equal(isOverdueAlert({
        ...overdue("2026-10-20T11:00:00.000Z"),
        status: "Completed"
    }, now), false);
});

test("limits regular-user subsidiary filters to created and collaborated alerts", () => {
    const alerts = [
        { id: "created", subsidiary: "North", createdByUserId: "user-1" },
        { id: "collaborated", subsidiary: "South", ownerUserIds: ["user-1"] },
        { id: "unrelated", subsidiary: "South", createdByUserId: "user-2" }
    ];
    const user = { id: "user-1", role: "User" };

    assert.deepEqual(
        getVisibleDashboardAlerts(alerts, user, "South").map(alert => alert.id),
        ["collaborated"]
    );
    assert.deepEqual(
        getVisibleDashboardAlerts(alerts, user).map(alert => alert.id),
        ["created", "collaborated"]
    );
});

test("calculates recurrence and reminder dates", () => {
    assert.equal(
        calculateNextDueDate("2025-01-31T12:00:00.000Z", 1, "month"),
        "2025-02-28T12:00:00.000Z"
    );
    assert.equal(
        calculateReminderDate("2025-02-28T12:00:00.000Z", 2, "hour"),
        "2025-02-28T10:00:00.000Z"
    );
});

test("renders HTML templates with escaped alert content", () => {
    const alert = {
        name: "<Monthly review>",
        description: "Check <balances>\nFollow up",
        dueDate: "2026-12-01T12:00:00.000Z",
        subsidiary: "A&B",
        owner: "Owner"
    };

    assert.equal(
        renderTemplate("{{alertName}}|{{description}}", alert, true),
        "&lt;Monthly review&gt;|Check &lt;balances&gt;<br>Follow up"
    );
    assert.equal(
        renderTemplate("{{alertName}}", alert),
        "<Monthly review>"
    );
});
