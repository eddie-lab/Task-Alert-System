const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const serverPath = path.resolve(__dirname, "..", "server.js");

test("anonymous visits to dashboard paths redirect to Microsoft signup", () => {
    const script = `
        const { app } = require(process.env.SERVER_PATH);
        const server = app.listen(0, "127.0.0.1", async () => {
            try {
                const base = "http://127.0.0.1:" + server.address().port;
                const results = [];
                for (const route of ["/", "/index.html"]) {
                    const response = await fetch(base + route, { redirect: "manual" });
                    results.push({
                        route,
                        status: response.status,
                        location: response.headers.get("location")
                    });
                }
                console.log(JSON.stringify(results));
            } catch (error) {
                console.error(error);
                process.exitCode = 1;
            } finally {
                server.close();
            }
        });
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: {
            ...process.env,
            SERVER_PATH: serverPath,
            NODE_ENV: "test",
            SESSION_SECRET: "test-session-secret",
            STORAGE_PROVIDER: "json",
            COOKIE_SECURE: "false"
        }
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
    assert.deepEqual(
        output.map(({ route, status, location }) => ({ route, status, location })),
        [
            { route: "/", status: 302, location: "/signup.html" },
            { route: "/index.html", status: 302, location: "/signup.html" }
        ]
    );
});
