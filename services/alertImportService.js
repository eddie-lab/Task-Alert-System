const ExcelJS = require("exceljs");
const { getAssignableUsers } = require("./userService");
const { validateAlertInput } = require("./alertValidation");
const { validateReminderRepeat } = require("./reminderSchedule");

const MAX_IMPORT_ROWS = 100;

const HEADERS = [
    "Alert Name",
    "Description",
    "Subsidiary",
    "Collaborator Emails",
    "Due Date",
    "Due Time",
    "Frequency Value",
    "Frequency Unit",
    "Reminder Value",
    "Reminder Unit",
    "Reminder Repeat Value",
    "Reminder Repeat Unit",
    "Escalation Enabled",
    "Escalation Value",
    "Escalation Unit",
    "Escalation Recipient Emails"
];

const SUBSIDIARIES = [
    "Norrenberger Asset Management",
    "Norrenberger Financial Group",
    "International Energy Insurance Plc",
    "Norrenberger Pension"
];

function normalizeHeader(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function cellToString(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return "";
        return value.toISOString();
    }
    if (typeof value === "object") {
        if (typeof value.text === "string") return value.text.trim();
        if (typeof value.result !== "undefined") return cellToString(value.result);
        if (typeof value.richText === "object") {
            return value.richText.map((part) => part.text || "").join("").trim();
        }
    }
    return String(value).trim();
}

function parseEmailList(value) {
    return cellToString(value)
        .split(/[;,]+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function parseYesNo(value) {
    const raw = cellToString(value).toLowerCase();
    if (!raw) return false;
    return ["yes", "y", "true", "1"].includes(raw);
}

function excelSerialToDate(serial) {
    // Excel's day zero is 1899-12-30. Use noon UTC so date-only serials do not shift.
    const whole = Math.floor(Number(serial));
    const fraction = Number(serial) - whole;
    const utc = Date.UTC(1899, 11, 30) + whole * 86400000 + Math.round(fraction * 86400000);
    return new Date(utc);
}

function formatDateYmdUtc(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatTimeHmUtc(date) {
    const h = String(date.getUTCHours()).padStart(2, "0");
    const min = String(date.getUTCMinutes()).padStart(2, "0");
    return `${h}:${min}`;
}

function formatDateYmd(date) {
    // Local calendar day — avoids WAT/UTC shifting Excel dates back one day
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatTimeHm(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${min}`;
}

function parseDueDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return formatDateYmd(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return formatDateYmdUtc(excelSerialToDate(value));
    }
    const raw = cellToString(value);
    if (!raw) return "";
    // Already ISO or yyyy-mm-dd
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return formatDateYmd(parsed);
    return raw;
}

function parseDueTime(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return formatTimeHm(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        // Pure time fraction, or serial with time component
        if (value < 1) {
            const mins = Math.round(value * 24 * 60);
            const h = Math.floor(mins / 60) % 24;
            const m = mins % 60;
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
        return formatTimeHmUtc(excelSerialToDate(value));
    }
    const raw = cellToString(value);
    if (!raw) return "09:00";
    const match = raw.match(/(\d{1,2}):(\d{2})/);
    if (match) {
        return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
    }
    return raw;
}

async function buildTemplateBuffer() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Alert System";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Alerts", {
        views: [{ state: "frozen", ySplit: 1 }]
    });

    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF5" }
    };

    // Sample row — due date ~14 days ahead so validation passes when tried soon after download
    const sampleDue = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const sampleYmd = formatDateYmd(sampleDue);

    sheet.addRow([
        "Monthly Bank Reconciliation",
        "Complete monthly bank reconciliation for the subsidiary.",
        SUBSIDIARIES[0],
        "colleague@example.com",
        sampleYmd,
        "09:00",
        1,
        "month",
        24,
        "hour",
        0,
        "hour",
        "No",
        2,
        "hour",
        ""
    ]);

    HEADERS.forEach((_, index) => {
        sheet.getColumn(index + 1).width = Math.min(28, Math.max(14, HEADERS[index].length + 2));
    });

    // Simple lists for units (Excel data validation)
    const unitSheet = workbook.addWorksheet("Lists");
    unitSheet.getColumn(1).values = ["FrequencyUnit", "day", "week", "month", "quarter", "year"];
    unitSheet.getColumn(2).values = ["ReminderUnit", "minute", "hour", "day"];
    unitSheet.getColumn(3).values = ["EscalationUnit", "minute", "hour", "day"];
    unitSheet.getColumn(4).values = ["YesNo", "Yes", "No"];
    unitSheet.getColumn(5).values = ["Subsidiary", ...SUBSIDIARIES];
    unitSheet.state = "hidden";

    sheet.getColumn(8).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.dataValidation = {
                type: "list",
                allowBlank: false,
                formulae: ['"day,week,month,quarter,year"']
            };
        }
    });

    const guide = workbook.addWorksheet("Instructions");
    guide.getColumn(1).width = 28;
    guide.getColumn(2).width = 72;
    const lines = [
        ["How to use", "1) Keep the header row. 2) One alert per row. 3) Upload this file from Create Alert → Batch import."],
        ["Alert Name", "Required. Max 120 characters."],
        ["Description", "Optional."],
        ["Subsidiary", "Required. Use the exact name from the Subsidiary list."],
        ["Collaborator Emails", "Optional. Separate multiple with ; or , — must match users in the system. You and these collaborators receive the alert emails, the same as when you create an alert one at a time."],
        ["Due Date", "Required. Use YYYY-MM-DD (example: 2026-12-01). Must be in the future with Due Time."],
        ["Due Time", "Required. 24-hour HH:mm (example: 09:00)."],
        ["Frequency Value", "Required whole number (e.g. 1)."],
        ["Frequency Unit", "day, week, month, quarter, or year."],
        ["Reminder Value", "Number of units before due date."],
        ["Reminder Unit", "minute, hour, or day."],
        ["Reminder Repeat Value", "0 means no repeat. Otherwise interval between reminder repeats."],
        ["Reminder Repeat Unit", "minute, hour, or day."],
        ["Escalation Enabled", "Yes or No."],
        ["Escalation Value", "Required when escalation is Yes."],
        ["Escalation Unit", "minute, hour, or day."],
        ["Escalation Recipient Emails", "Optional. Notified only if the alert is not completed by its due date. Leave blank to use you and the collaborators."],
        ["Limits", `Up to ${MAX_IMPORT_ROWS} data rows per upload. Invalid rows are skipped; valid rows are still created.`]
    ];
    lines.forEach((row) => guide.addRow(row));
    guide.getRow(1).font = { bold: true };

    return workbook.xlsx.writeBuffer();
}

function mapRowToObject(headerRow, dataRow) {
    const obj = {};
    headerRow.forEach((header, index) => {
        const key = normalizeHeader(header);
        if (!key) return;
        obj[key] = dataRow[index];
    });
    return obj;
}

function pick(obj, ...names) {
    for (const name of names) {
        const key = normalizeHeader(name);
        if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && cellToString(obj[key]) !== "") {
            return obj[key];
        }
    }
    return "";
}

// Same rule as the Create Alert form: the person creating the alert and the chosen collaborators are the
// email recipients. Nobody types them separately. (Case-insensitive, first spelling wins.)
function buildRecipients(creatorEmail, collaboratorEmails = [], extraEmails = []) {
    const seen = new Set();
    return [creatorEmail, ...collaboratorEmails, ...extraEmails]
        .map((email) => String(email || "").trim())
        .filter((email) => {
            const key = email.toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function rowToAlertInput(rowObj, usersByEmail, forcedSubsidiary, creatorEmail = "") {
    const collaboratorEmails = parseEmailList(pick(rowObj, "Collaborator Emails", "Collaborators", "Owner Emails"));
    const ownerUserIds = [];
    const collaboratorRecipientEmails = [];
    for (const email of collaboratorEmails) {
        const user = usersByEmail.get(email.toLowerCase());
        if (!user) {
            return { error: `Unknown collaborator email: ${email}` };
        }
        ownerUserIds.push(user.id);
        collaboratorRecipientEmails.push(user.email);
    }
    // Older copies of the template still have a "Recipient Emails" column. Keep honouring it as extra
    // addresses (the form allows typing extras too), so nobody silently stops getting emails.
    const legacyExtraRecipients = parseEmailList(pick(rowObj, "Recipient Emails", "Recipients"));

    const dueDate = parseDueDate(pick(rowObj, "Due Date"));
    const dueTime = parseDueTime(pick(rowObj, "Due Time"));
    const subsidiary = forcedSubsidiary || cellToString(pick(rowObj, "Subsidiary"));

    const input = {
        name: cellToString(pick(rowObj, "Alert Name", "Name")),
        description: cellToString(pick(rowObj, "Description")),
        subsidiary,
        ownerUserIds,
        dueDate: dueDate && dueTime ? `${dueDate}T${dueTime}` : dueDate,
        frequencyValue: cellToString(pick(rowObj, "Frequency Value")) || "1",
        frequencyUnit: (cellToString(pick(rowObj, "Frequency Unit")) || "month").toLowerCase(),
        reminderValue: cellToString(pick(rowObj, "Reminder Value")) || "24",
        reminderUnit: (cellToString(pick(rowObj, "Reminder Unit")) || "hour").toLowerCase(),
        reminderRepeatValue: cellToString(pick(rowObj, "Reminder Repeat Value")) || "0",
        reminderRepeatUnit: (cellToString(pick(rowObj, "Reminder Repeat Unit")) || "hour").toLowerCase(),
        escalationEnabled: parseYesNo(pick(rowObj, "Escalation Enabled")),
        escalationValue: cellToString(pick(rowObj, "Escalation Value")) || "0",
        escalationUnit: (cellToString(pick(rowObj, "Escalation Unit")) || "hour").toLowerCase(),
        recipients: buildRecipients(creatorEmail, collaboratorRecipientEmails, legacyExtraRecipients),
        escalationRecipients: parseEmailList(pick(rowObj, "Escalation Recipient Emails", "Escalation Recipients"))
    };

    const validation = await validateAlertInput(input);
    if (validation.error) return { error: validation.error };

    const repeatError = validateReminderRepeat(validation.value);
    if (repeatError) return { error: repeatError };

    return { value: validation.value };
}

async function parseWorkbook(buffer, { forcedSubsidiary = null, creatorEmail = "" } = {}) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Alerts") || workbook.worksheets[0];
    if (!sheet) {
        return { error: "The file has no worksheet to import." };
    }

    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
        rows.push(row.values.slice(1)); // exceljs is 1-based; index 0 empty
    });

    if (rows.length < 2) {
        return { error: "The template has no data rows. Add one alert per row under the header." };
    }

    const headerRow = rows[0].map((cell) => cellToString(cell));
    const normalized = headerRow.map(normalizeHeader);
    if (!normalized.includes("alert name") && !normalized.includes("name")) {
        return { error: "Missing required column: Alert Name. Download a fresh template and try again." };
    }

    const dataRows = rows.slice(1).map((cells, index) => ({
        excelRowNumber: index + 2, // header is row 1
        cells
    }));

    const nonEmpty = dataRows.filter(({ cells }) => {
        const rowObj = mapRowToObject(headerRow, cells);
        return Object.values(rowObj).some((v) => cellToString(v) !== "");
    });

    if (!nonEmpty.length) {
        return { error: "No alert rows found in the file." };
    }

    if (nonEmpty.length > MAX_IMPORT_ROWS) {
        return { error: `Too many rows. Import at most ${MAX_IMPORT_ROWS} alerts at a time.` };
    }

    const assignable = await getAssignableUsers();
    const usersByEmail = new Map(
        assignable
            .filter((user) => user.email)
            .map((user) => [String(user.email).toLowerCase(), user])
    );

    const results = [];
    for (const { excelRowNumber, cells } of nonEmpty) {
        const rowObj = mapRowToObject(headerRow, cells);
        const parsed = await rowToAlertInput(rowObj, usersByEmail, forcedSubsidiary, creatorEmail);
        if (parsed.error) {
            results.push({ row: excelRowNumber, ok: false, error: parsed.error });
        } else {
            results.push({ row: excelRowNumber, ok: true, value: parsed.value });
        }
    }

    return { results };
}

module.exports = {
    HEADERS,
    MAX_IMPORT_ROWS,
    buildTemplateBuffer,
    parseWorkbook,
    rowToAlertInput,
    buildRecipients
};
