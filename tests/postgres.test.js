// PostgreSQL tests. They only run when TEST_DATABASE_URL points at an EMPTY test database,
// because they overwrite the app_documents rows. Example:
//   TEST_DATABASE_URL=postgresql://alert_app:pw@localhost:5432/alert_test PG_SSL=false npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "Set TEST_DATABASE_URL (an empty test database) to run the PostgreSQL tests.";

test("PostgreSQL storage", { skip }, async t => {
    process.env.STORAGE_PROVIDER = "sql";
    process.env.DATABASE_URL = url;
    const db = require("../services/database");

    await db.initializeDatabase();
    t.after(() => db.closeDatabase());

    await t.test("saves and reads a document", async () => {
        await db.saveDocument("subsidiaryDomains", { n: 0 });
        assert.deepEqual(await db.getDocument("subsidiaryDomains"), { n: 0 });
    });

    await t.test("concurrent updates in one process are not lost", async () => {
        await db.saveDocument("subsidiaryDomains", { n: 0 });
        await Promise.all(Array.from({ length: 25 }, () =>
            db.updateDocument("subsidiaryDomains", v => ({ ...v, n: v.n + 1 }))));
        assert.equal((await db.getDocument("subsidiaryDomains")).n, 25);
    });

    await t.test("a failed update saves nothing", async () => {
        await db.saveDocument("subsidiaryDomains", { n: 7 });
        await assert.rejects(db.updateDocument("subsidiaryDomains", () => { throw new Error("stop"); }), /stop/);
        assert.equal((await db.getDocument("subsidiaryDomains")).n, 7);
    });

    await t.test("only one holder of a named job runs at a time", async () => {
        let inside = 0;
        let maxInside = 0;
        const job = async () => {
            inside += 1;
            maxInside = Math.max(maxInside, inside);
            await new Promise(r => setTimeout(r, 100));
            inside -= 1;
        };
        const results = await Promise.all([db.runExclusive("t", job), db.runExclusive("t", job), db.runExclusive("t", job)]);
        assert.equal(maxInside, 1);
        assert.equal(results.filter(r => r.ran).length, 1);
    });
});
