const { getAssignableUsers } = require("./userService");

const FREQUENCY_UNITS = ["day", "week", "month", "quarter", "year"];
const REMINDER_UNITS = ["minute", "hour", "day"];
const ESCALATION_UNITS = ["minute", "hour", "day"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function validateAlertInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { error: "Alert details are required." };
    }

    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const subsidiary = typeof input.subsidiary === "string" ? input.subsidiary.trim() : "";

    if (!name || name.length > 120) {
        return { error: "Alert name is required and must be 120 characters or fewer." };
    }

    if (description.length > 2000) {
        return { error: "Description must be 2000 characters or fewer." };
    }

    if (!subsidiary || subsidiary.length > 120) {
        return { error: "A valid subsidiary is required." };
    }

    if (typeof input.dueDate !== "string" || !input.dueDate.trim()) {
        return { error: "A due date and time are required." };
    }

    const dueDate = new Date(input.dueDate);
    if (!Number.isFinite(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
        return { error: "The due date and time must be in the future." };
    }

    const frequencyValue = Number(input.frequencyValue);
    if (!Number.isInteger(frequencyValue) || frequencyValue < 1 || frequencyValue > 1000) {
        return { error: "Repeat frequency must be a whole number between 1 and 1000." };
    }

    if (!FREQUENCY_UNITS.includes(input.frequencyUnit)) {
        return { error: "Choose a valid repeat frequency." };
    }

    const reminderValue = Number(input.reminderValue);
    if (!Number.isFinite(reminderValue) || reminderValue < 0 || reminderValue > 100000) {
        return { error: "Reminder time must be a number between 0 and 100000." };
    }

    if (!REMINDER_UNITS.includes(input.reminderUnit)) {
        return { error: "Choose a valid reminder unit." };
    }

    const reminderRepeatValue = Number(input.reminderRepeatValue);
    if (!Number.isInteger(reminderRepeatValue) || reminderRepeatValue < 0 || reminderRepeatValue > 100000) {
        return { error: "Reminder repeat interval must be a whole number between 0 and 100000." };
    }

    if (!REMINDER_UNITS.includes(input.reminderRepeatUnit)) {
        return { error: "Choose a valid reminder repeat unit." };
    }

    if (reminderRepeatValue > 0 && reminderValue === 0) {
        return { error: "A reminder is required before repeat reminders can be scheduled." };
    }

    if (typeof input.escalationEnabled !== "boolean" &&
        input.escalationEnabled !== "true" &&
        input.escalationEnabled !== "false") {
        return { error: "Escalation enabled must be true or false." };
    }

    const escalationEnabled = input.escalationEnabled === true || input.escalationEnabled === "true";
    const escalationValue = Number(input.escalationValue);
    if (!Number.isFinite(escalationValue) || escalationValue < 0 || escalationValue > 100000) {
        return { error: "Escalation time must be a number between 0 and 100000." };
    }

    if (!ESCALATION_UNITS.includes(input.escalationUnit)) {
        return { error: "Choose a valid escalation unit." };
    }

    if (escalationEnabled && escalationValue < 1) {
        return { error: "Escalation time must be at least 1 when escalation is enabled." };
    }

    for (const field of ["recipients", "escalationRecipients"]) {
        if (input[field] !== undefined && !Array.isArray(input[field])) {
            return { error: `${field === "recipients" ? "Recipients" : "Escalation recipients"} must be a list of email addresses.` };
        }

        const addresses = input[field] || [];
        if (addresses.length > 100 || addresses.some(address =>
            typeof address !== "string" || !EMAIL_PATTERN.test(address.trim())
        )) {
            return { error: `Enter up to 100 valid ${field === "recipients" ? "recipient" : "escalation recipient"} email addresses.` };
        }
    }

    if (input.ownerUserIds !== undefined && !Array.isArray(input.ownerUserIds)) {
        return { error: "Collaborators must be provided as a list." };
    }

    if ((input.ownerUserIds || []).length > 50) {
        return { error: "Choose no more than 50 collaborators." };
    }

    const ownerUserIds = [...new Set(input.ownerUserIds || [])];
    const assignableUsers = ownerUserIds.length ? await getAssignableUsers() : [];
    const usersById = new Map(assignableUsers.map(user => [user.id, user]));
    if (ownerUserIds.length > 50 || ownerUserIds.some(id =>
        typeof id !== "string" || !usersById.has(id)
    )) {
        return { error: "One or more selected collaborators are invalid or inactive." };
    }

    const normalizeEmails = addresses => [...new Set(addresses.map(address => address.trim()))];

    return {
        value: {
            name,
            description,
            subsidiary,
            ownerUserIds,
            owner: ownerUserIds.map(id => usersById.get(id).name).join(", "),
            dueDate: dueDate.toISOString(),
            frequencyValue,
            frequencyUnit: input.frequencyUnit,
            reminderValue,
            reminderUnit: input.reminderUnit,
            reminderRepeatValue,
            reminderRepeatUnit: input.reminderRepeatUnit,
            escalationEnabled,
            escalationValue,
            escalationUnit: input.escalationUnit,
            recipients: normalizeEmails(input.recipients || []),
            escalationRecipients: normalizeEmails(input.escalationRecipients || [])
        }
    };
}

module.exports = { validateAlertInput };
