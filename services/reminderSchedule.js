/* =========================================================
   REPEATING REMINDERS
   ---------------------------------------------------------
   An alert can repeat its reminder every N minutes/hours/days
   after the first one, right up until the due date.
========================================================= */

const UNIT_MS = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000
};
const POST_DUE_REMINDER_HOURS = [2, 4, 8, 16, 24, 32, 48, 72];

const MIN_REPEAT_MINUTES = 5;
const MAX_REMINDERS = 50;


function toMilliseconds(value, unit) {

    const number = Number(value);

    if (!number || number <= 0 || !UNIT_MS[unit]) {
        return 0;
    }

    return number * UNIT_MS[unit];
}


function getRepeatMs(alert) {

    return toMilliseconds(
        alert.reminderRepeatValue,
        alert.reminderRepeatUnit
    );
}


/* Next reminder time strictly after `after`, on the repeat schedule
   that started at reminderDate. Returns null when there is none
   left before the due date (or the alert doesn't repeat). Missed
   slots (e.g. the server was down) are skipped, not sent in a burst. */

function getNextReminderDate(alert, after) {

    const intervalMs = getRepeatMs(alert);

    if (!intervalMs || !alert.reminderDate) {
        return null;
    }

    const due = new Date(alert.dueDate).getTime();

    let next = new Date(alert.reminderDate).getTime() + intervalMs;

    while (next <= after.getTime()) {
        next += intervalMs;
    }

    return next < due ? new Date(next).toISOString() : null;
}



function validateReminderRepeat(alert) {

    const value = Number(alert.reminderRepeatValue) || 0;

    if (value === 0) {
        return null;
    }

    if (value < 0) {
        return "The reminder repeat interval can't be negative.";
    }

    const intervalMs = getRepeatMs(alert);

    if (!intervalMs) {
        return "Choose minutes, hours or days for the reminder repeat interval.";
    }

    if (intervalMs < MIN_REPEAT_MINUTES * UNIT_MS.minute) {
        return `Reminders can repeat at most every ${MIN_REPEAT_MINUTES} minutes.`;
    }

    const leadMs = toMilliseconds(alert.reminderValue, alert.reminderUnit);

    if (!leadMs) {
        return null;
    }

    const count = Math.floor(leadMs / intervalMs) + 1;

    if (count > MAX_REMINDERS) {

        return (
            `That would send ${count} reminders (maximum ${MAX_REMINDERS}). ` +
            `Use a longer repeat interval or a shorter reminder window.`
        );
    }

    return null;
}

// After the due date, send a few more reminders at fixed intervals, then stop. Returns null when there are no more reminders to send.
function getNextPostDueReminderDate(alert, after) {
    if (!alert.dueDate) return null;

    const dueMs = new Date(alert.dueDate).getTime();
    const afterMs = after.getTime();

    const lastOffsetMs = POST_DUE_REMINDER_HOURS.at(-1) * 60 * 60 * 1000;
    if (afterMs >= dueMs + lastOffsetMs) {
        return null; // sequence finished
    }

    for (const hours of POST_DUE_REMINDER_HOURS) {
        const candidate = dueMs + hours * 60 * 60 * 1000;
        if (candidate > afterMs) {
            return new Date(candidate).toISOString();
        }
    }

    return null;
}


module.exports = {
    getNextReminderDate,
    validateReminderRepeat,
    getNextPostDueReminderDate
};