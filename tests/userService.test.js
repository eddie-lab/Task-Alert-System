const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const userServicePath = path.resolve(__dirname, "..", "services", "userService.js");

test("concurrent user creation preserves both accounts and reuses an existing email", () => {
    const script = `
        const Module = require("node:module");
        const originalLoad = Module._load;
        let users = [];
        let writeQueue = Promise.resolve();

        const database = {
            getDocument: async () => users.map(user => ({ ...user })),
            saveDocument: async (_key, value) => {
                users = value.map(user => ({ ...user }));
            },
            updateDocument: async (_key, mutator) => {
                const update = writeQueue.then(async () => {
                    users = await mutator(users.map(user => ({ ...user })));
                    return users;
                });
                writeQueue = update.catch(() => {});
                return update;
            }
        };

        Module._load = function(request, parent, isMain) {
            if (parent && parent.filename === process.env.USER_SERVICE_PATH &&
                request === "./database") {
                return database;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const { createUser } = require(process.env.USER_SERVICE_PATH);
        Promise.all([
            createUser({ name: "One User", email: "one@example.test", subsidiary: "North" }),
            createUser({ name: "Two User", email: "two@example.test", subsidiary: "South" })
        ]).then(async ([one, two]) => {
            const existing = await createUser({
                name: "Changed Name",
                email: "one@example.test",
                subsidiary: "Changed"
            });
            console.log(JSON.stringify({
                ids: users.map(user => user.id),
                emails: users.map(user => user.email),
                firstId: one.id,
                secondId: two.id,
                existingId: existing.id
            }));
        }).catch(error => {
            console.error(error);
            process.exitCode = 1;
        });
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: {
            ...process.env,
            USER_SERVICE_PATH: userServicePath
        }
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output.ids, ["USR-000001", "USR-000002"]);
    assert.deepEqual(output.emails, ["one@example.test", "two@example.test"]);
    assert.equal(output.existingId, output.firstId);
});
