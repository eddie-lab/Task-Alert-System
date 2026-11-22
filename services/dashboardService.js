const { canViewAlert } = require("./userService");

function isOverdueAlert(alert, now = new Date()) {
    if (!alert.active || !alert.dueDate ||
        alert.status === "Completed" || alert.status === "Cancelled") {
        return false;
    }

    const dueDate = new Date(alert.dueDate);
    return Number.isFinite(dueDate.getTime()) && dueDate < now;
}

function getVisibleDashboardAlerts(alerts, user, requestedSubsidiary = "") {
    const visibleAlerts = alerts.filter(alert => canViewAlert(user, alert));

    return requestedSubsidiary
        ? visibleAlerts.filter(alert => alert.subsidiary === requestedSubsidiary)
        : visibleAlerts;
}

module.exports = { isOverdueAlert, getVisibleDashboardAlerts };
