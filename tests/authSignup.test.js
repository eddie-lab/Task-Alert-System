const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const authPath = path.resolve(__dirname, "..", "routes", "auth.js");

test("first-time Microsoft users must complete signup before account creation", () => {
    const script = `
        const Module = require("node:module");
        const originalLoad = Module._load;
        let createdUser = null;
        let session;

        Module._load = function(request, parent, isMain) {
            if (parent && parent.filename === process.env.AUTH_ROUTE_PATH) {
                if (request === "@azure/msal-node") {
                    return {
                        ConfidentialClientApplication: class {
                            async acquireTokenByCode() {
                                return { account: { username: "new.user@example.com", name: "New User" } };
                            }
                        }
                    };
                }
                if (request === "../services/subsidiaryDomainService") {
                    return {
                        resolveSubsidiary: async () => ({
                            allowed: true,
                            ambiguous: false,
                            subsidiary: "North"
                        })
                    };
                }
                if (request === "../services/userService") {
                    return {
                        emailExists: async () => false,
                        getUserByEmail: async () => null,
                        createUser: async user => {
                            createdUser = user;
                            return { id: "USR-000001", ...user };
                        }
                    };
                }
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        process.env.MS_CLIENT_ID = "test-client";
        process.env.MS_CLIENT_SECRET = "test-secret";
        process.env.MS_REDIRECT_URI = "https://example.test/api/auth/callback";
        const express = require("express");
        const { router } = require(process.env.AUTH_ROUTE_PATH);
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.session = session || (session = {});
            next();
        });
        app.use("/api/auth", router);

        const server = app.listen(0, "127.0.0.1", async () => {
            try {
                const base = "http://127.0.0.1:" + server.address().port;
                const callback = await fetch(base + "/api/auth/callback?code=test-code", {
                    redirect: "manual"
                });
                const createdBeforeConfirmation = createdUser !== null;
                const completion = await fetch(base + "/api/auth/complete-signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
                const completionBody = await completion.json();
                console.log(JSON.stringify({
                    callbackStatus: callback.status,
                    callbackLocation: callback.headers.get("location"),
                    createdBeforeConfirmation,
                    completionStatus: completion.status,
                    completionBody,
                    createdUser,
                    userId: session.userId
                }));
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
            AUTH_ROUTE_PATH: authPath
        }
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.callbackStatus, 302);
    assert.equal(output.callbackLocation, "/signup.html?needsSignup=1");
    assert.equal(output.createdBeforeConfirmation, false);
    assert.equal(output.completionStatus, 200);
    assert.deepEqual(output.completionBody, { success: true });
    assert.equal(output.createdUser.subsidiary, "North");
    assert.equal(output.userId, "USR-000001");
});
