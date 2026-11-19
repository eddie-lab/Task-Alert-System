const {
    sendReminderEmail,
    sendDueDateEmail,
    sendEscalationEmail
} = require("./emailService");
const {
    getNextReminderDate,
    getNextPostDueReminderDate
} = require("./reminderSchedule");

const { getDocument, updateDocument } = require("./database");

// Re-export low-level read for callers that only need a snapshot.
async function getAlerts() {
    return getDocument("alerts");
}

function addMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();

    result.setDate(1);
    result.setMonth(result.getMonth() + months);

    const lastDayOfMonth = new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0
    ).getDate();

    result.setDate(Math.min(originalDay, lastDayOfMonth));
    return result;
}

function calculateNextDueDate(dueDate, frequencyValue, frequencyUnit) {
    const date = new Date(dueDate);
    const value = Number(frequencyValue);

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error("Invalid frequency value");
    }

    switch (frequencyUnit) {
        case "day":
            date.setDate(date.getDate() + value);
            break;
        case "week":
            date.setDate(date.getDate() + value * 7);
            break;
        case "month":
            return addMonths(date, value).toISOString();
        case "quarter":
            return addMonths(date, value * 3).toISOString();
        case "year":
            date.setFullYear(date.getFullYear() + value);
            break;
        default:
            throw new Error(`Unsupported frequency unit: ${frequencyUnit}`);
    }

    return date.toISOString();
}

function calculateReminderDate(dueDate, reminderValue, reminderUnit) {
    const date = new Date(dueDate);
    const value = Number(reminderValue);

    if (!value || value <= 0) {
        return null;
    }

    switch (reminderUnit) {
        case "minute":
            date.setMinutes(date.getMinutes() - value);
            break;
        case "hour":
            date.setHours(date.getHours() - value);
            break;
        case "day":
            date.setDate(date.getDate() - value);
            break;
        default:
            throw new Error(`Unsupported reminder unit: ${reminderUnit}`);
    }

    return date.toISOString();
}

function calculateEscalationDate(dueDate, escalationValue, escalationUnit) {
    const date = new Date(dueDate);
    const value = Number(escalationValue);

    if (!value || value <= 0) {
        return null;
    }

    switch (escalationUnit) {
        case "minute":
            date.setMinutes(date.getMinutes() + value);
            break;
        case "hour":
            date.setHours(date.getHours() + value);
            break;
        case "day":
            date.setDate(date.getDate() + value);
            break;
        default:
            throw new Error(`Unsupported escalation unit: ${escalationUnit}`);
    }

    return date.toISOString();
}

let processing = false;

/**
 * Apply a list of per-alert patches under the document lock.
 * Each patch is { id, apply(alert) } and runs against the latest document.
 */
async function applyAlertPatches(patches) {
    if (!patches.length) {
        return;
    }

    await updateDocument("alerts", alerts => {
        const byId = new Map(alerts.map(alert => [alert.id, alert]));

        for (const patch of patches) {
            const alert = byId.get(patch.id);
            if (alert) {
                patch.apply(alert);
            }
        }

        return alerts;
    });
}

async function processAlerts() {
    if (processing) {
        return;
    }

    processing = true;
    try {
        // Snapshot only — no lock held while talking to the mail server.
        const alerts = await getAlerts();
        const now = new Date();
        const patches = [];

        for (const alert of alerts) {
            const isLive = alert.active === true &&
                alert.status !== "Completed" &&
                alert.status !== "Cancelled";

            if (!isLive) {
                continue;
            }

            if (!alert.reminderSent && alert.reminderDate &&
                new Date(alert.reminderDate) <= now) {
                try {
                    await sendReminderEmail(alert);
                    const nextReminder = getNextReminderDate(alert, now);
                    const alertId = alert.id;

                    patches.push({
                        id: alertId,
                        apply(target) {
                            if (nextReminder) {
                                target.reminderDate = nextReminder;
                            } else {
                                target.reminderSent = true;
                            }
                            if (target.status !== "Escalated" &&
                                target.status !== "Post-Due Reminder Sent") {
                                target.status = "Reminder Sent";
                            }
                        }
                    });
                    console.log(`Reminder sent: ${alert.id} - ${alert.name}`);
                } catch (error) {
                    console.error(`Failed to send reminder for ${alert.id}:`, (error.code ? `${error.code}: ` : "") + error.message);
                }
            }

            if (!alert.dueNoticeSent && alert.dueDate &&
                new Date(alert.dueDate) <= now) {
                try {
                    await sendDueDateEmail(alert);
                    const alertId = alert.id;
                    patches.push({
                        id: alertId,
                        apply(target) {
                            target.dueNoticeSent = true;
                        }
                    });
                    console.log(`Due-date notice sent: ${alert.id} - ${alert.name}`);
                } catch (error) {
                    console.error(`Failed to send due-date notice for ${alert.id}:`, (error.code ? `${error.code}: ` : "") + error.message);
                }
            }

            if (alert.escalationEnabled && !alert.escalationSent &&
                alert.escalationDate && new Date(alert.escalationDate) <= now) {
                try {
                    await sendEscalationEmail(alert);
                    const alertId = alert.id;
                    patches.push({
                        id: alertId,
                        apply(target) {
                            target.escalationSent = true;
                            target.status = "Escalated";
                        }
                    });
                    console.log(`Escalation sent: ${alert.id} - ${alert.name}`);
                } catch (error) {
                    console.error(`Failed to send escalation for ${alert.id}:`, (error.code ? `${error.code}: ` : "") + error.message);
                }
            }

            if (!alert.postDueReminderSent && alert.dueDate &&
                new Date(alert.dueDate) <= now) {
                if (!alert.postDueReminderDate) {
                    const firstReminder = getNextPostDueReminderDate(alert, now);
                    if (firstReminder) {
                        const alertId = alert.id;
                        patches.push({
                            id: alertId,
                            apply(target) {
                                if (!target.postDueReminderDate) {
                                    target.postDueReminderDate = firstReminder;
                                }
                            }
                        });
                    }
                }

                if (alert.postDueReminderDate &&
                    new Date(alert.postDueReminderDate) <= now) {
                    try {
                        await sendReminderEmail(alert);
                        const nextReminder = getNextPostDueReminderDate(alert, now);
                        const alertId = alert.id;
                        patches.push({
                            id: alertId,
                            apply(target) {
                                if (nextReminder) {
                                    target.postDueReminderDate = nextReminder;
                                } else {
                                    target.postDueReminderSent = true;
                                    target.postDueReminderDate = null;
                                }
                                if (target.status !== "Escalated") {
                                    target.status = "Post-Due Reminder Sent";
                                }
                            }
                        });
                        console.log(`Post-due reminder sent: ${alert.id}`);
                    } catch (error) {
                        console.error(`Failed post-due reminder for ${alert.id}:`, (error.code ? `${error.code}: ` : "") + error.message);
                    }
                }
            }
        }

        await applyAlertPatches(patches);
    } finally {
        processing = false;
    }
}

module.exports = {
    processAlerts,
    calculateNextDueDate,
    calculateReminderDate,
    calculateEscalationDate
};
