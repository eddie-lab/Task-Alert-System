const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const { buildTemplateBuffer, buildRecipients } = require("../services/alertImportService");

test("batch import recipients are the creator and the collaborators, like the single-alert form", () => {
    assert.deepEqual(
        buildRecipients("me@example.com", ["ada@example.com", "bayo@example.com"]),
        ["me@example.com", "ada@example.com", "bayo@example.com"]
    );
});

test("batch import recipients ignore repeats in any letter case and blank creators", () => {
    assert.deepEqual(
        buildRecipients("Me@example.com", ["ME@example.com", "ada@example.com"], ["ADA@example.com", "extra@example.com"]),
        ["Me@example.com", "ada@example.com", "extra@example.com"]
    );
    assert.deepEqual(buildRecipients("", ["ada@example.com"]), ["ada@example.com"]);
    assert.deepEqual(buildRecipients(undefined, []), []);
});

test("the import template has no Recipient Emails column and its sample row still lines up", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplateBuffer());

    const sheet = workbook.getWorksheet("Alerts");
    const header = sheet.getRow(1).values.slice(1);
    const sample = sheet.getRow(2).values.slice(1);

    assert.equal(header.includes("Recipient Emails"), false);
    assert.ok(header.includes("Collaborator Emails"));
    assert.ok(header.includes("Escalation Recipient Emails"));
    assert.equal(sample[header.indexOf("Frequency Unit")], "month");
    assert.equal(sample[header.indexOf("Escalation Unit")], "hour");
});
