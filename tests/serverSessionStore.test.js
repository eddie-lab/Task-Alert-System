const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const serverPath = path.resolve(__dirname, "..", "server.js");

function loadServer(env) {
    return spawnSync(process.execPath, ["-e", `require(${JSON.stringify(serverPath)})`], {
        encoding: "utf8",
        env: {
            ...process.env,
            NODE_ENV: "production",
            SESSION_SECRET: "test-session-secret",
            ...env
        }
    });
}

test("production refuses JSON storage instead of using MemoryStore", () => {
    const result = loadServer({ STORAGE_PROVIDER: "json" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /STORAGE_PROVIDER=sql is required in production/);
});

test("SQL configuration does not initialize Express MemoryStore", () => {
    const result = loadServer({ STORAGE_PROVIDER: "sql" });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /MemoryStore/);
});
