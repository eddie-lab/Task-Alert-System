function isOverdueAlert(alert, now = new Date()) {
    if (!alert.active || !alert.dueDate ||
        alert.status === "Completed" || alert.status === "Cancelled") {
        return false;
    }

    const dueDate = new Date(alert.dueDate);
    return Number.isFinite(dueDate.getTime()) && dueDate < now;
}

function getVisibleDashboardAlerts(alerts, user, requestedSubsidiary = "") {
    const visibleAlerts = user && user.role === "Administrator"
        ? alerts
        : alerts.filter(alert =>
            alert.createdByUserId === user.id ||
            (alert.ownerUserIds || []).includes(user.id)
        );

    return requestedSubsidiary
        ? visibleAlerts.filter(alert => alert.subsidiary === requestedSubsidiary)
        : visibleAlerts;
}

module.exports = { isOverdueAlert, getVisibleDashboardAlerts };
