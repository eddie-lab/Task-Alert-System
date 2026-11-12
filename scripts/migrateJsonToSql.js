const fs = require("fs");
require("dotenv").config();
const path = require("path");
const {
    closeDatabase,
    importDocumentIfMissing,
    initializeDatabase
} = require("../services/database");

const documents = [
    ["alerts", "alerts.json"],
    ["users", "users.json"],
    ["templates", "emailTemplates.json"],
    ["subsidiaryDomains", "subsidiaryDomains.json"]
];

async function migrate() {
    await initializeDatabase();
    let importedCount = 0;
    let skippedCount = 0;

    for (const [key, filename] of documents) {
        const filePath = path.join(__dirname, "..", "data", filename);
        const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const imported = await importDocumentIfMissing(key, value);

        if (imported) {
            importedCount += 1;
            console.log(`Imported ${filename} into SQL Server.`);
        } else {
            skippedCount += 1;
            console.log(`Skipped ${filename}; SQL Server already has "${key}".`);
        }
    }

    console.log(`JSON import complete. Imported: ${importedCount}; skipped: ${skippedCount}.`);
}

async function main() {
    try {
        await migrate();
    } catch (error) {
        console.error("JSON-to-SQL migration failed:", error);
        process.exitCode = 1;
    }

    try {
        await closeDatabase();
    } catch (error) {
        console.error("Unable to close the SQL Server connection:", error);
        process.exitCode = 1;
    }
}

main();
