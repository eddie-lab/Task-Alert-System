const fs = require("fs");
const path = require("path");

let pool = null;
let poolPromise = null;

// Per-document serial queue. Each key has at most one critical section
// running; further callers chain onto the same promise tail.
const documentQueues = new Map();

const dataFiles = {
    alerts: "alerts.json",
    users: "users.json",
    templates: "emailTemplates.json",
    subsidiaryDomains: "subsidiaryDomains.json"
};

const DOCUMENT_KEYS = Object.keys(dataFiles);

function isSqlStorage() {
    const provider = (process.env.STORAGE_PROVIDER || "json").toLowerCase();

    if (provider !== "json" && provider !== "sql") {
        throw new Error('STORAGE_PROVIDER must be either "json" or "sql".');
    }

    return provider === "sql";
}

function resolveSsl() {
    if (process.env.PG_SSL === "false") {
        return false;
    }
    if (process.env.PG_SSL === "true" || process.env.DATABASE_URL) {
        return {
            rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false"
        };
    }
    return false;
}

function getPgConfig() {
    const ssl = resolveSsl();
    const poolOptions = {
        max: Number(process.env.PG_POOL_MAX) || 10,
        idleTimeoutMillis: 30000
    };

    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl,
            ...poolOptions
        };
    }

    const required = ["PG_HOST", "PG_DATABASE", "PG_USER", "PG_PASSWORD"];
    const missing = required.filter(name => !process.env[name]);

    if (missing.length) {
        throw new Error(
            `Missing PostgreSQL configuration: ${missing.join(", ")}. ` +
            `Set DATABASE_URL or the individual PG_* variables.`
        );
    }

    return {
        host: process.env.PG_HOST,
        port: Number(process.env.PG_PORT) || 5432,
        database: process.env.PG_DATABASE,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        ssl,
        ...poolOptions
    };
}

async function getPool() {
    if (pool) {
        return pool;
    }

    if (!poolPromise) {
        poolPromise = (async () => {
            const { Pool } = require("pg");
            const nextPool = new Pool(getPgConfig());

            nextPool.on("error", err => {
                console.error("Unexpected PostgreSQL pool error:", err);
            });

            const client = await nextPool.connect();
            client.release();

            pool = nextPool;
            return nextPool;
        })().catch(error => {
            poolPromise = null;
            pool = null;
            throw error;
        });
    }

    return poolPromise;
}

/**
 * Run `task` exclusively for a document key.
 * Concurrent callers for the same key wait in line; different keys run in parallel.
 */
function withDocumentLock(key, task) {
    if (!dataFiles[key]) {
        return Promise.reject(new Error(`Unknown application data document "${key}".`));
    }

    const previous = documentQueues.get(key) || Promise.resolve();

    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });

    // Tail stays in the map until this task finishes so newcomers chain correctly.
    const tail = previous.catch(() => {}).then(() => gate);
    documentQueues.set(key, tail);

    return previous.catch(() => {}).then(async () => {
        try {
            return await task();
        } finally {
            release();
            if (documentQueues.get(key) === tail) {
                documentQueues.delete(key);
            }
        }
    });
}

async function initializeDatabase() {
    if (!isSqlStorage()) {
        return;
    }

    const client = await (await getPool()).connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_documents (
                document_key   TEXT PRIMARY KEY,
                document_value JSONB NOT NULL,
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
    } finally {
        client.release();
    }
}

async function verifyRequiredDocuments() {
    if (!isSqlStorage()) {
        for (const [key, filename] of Object.entries(dataFiles)) {
            const filePath = path.join(__dirname, "..", "data", filename);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Required local data file for "${key}" is missing: ${filePath}`);
            }
        }
        return;
    }

    const result = await (await getPool()).query(
        `SELECT document_key
         FROM app_documents
         WHERE document_key = ANY($1::text[])`,
        [DOCUMENT_KEYS]
    );

    const found = new Set(result.rows.map(row => row.document_key));
    const missing = DOCUMENT_KEYS.filter(key => !found.has(key));

    if (missing.length) {
        throw new Error(
            `PostgreSQL is missing required data (${missing.join(", ")}). ` +
            `Run "npm run migrate:sql" before starting the app.`
        );
    }
}

async function readDocument(key) {
    if (!dataFiles[key]) {
        throw new Error(`Unknown application data document "${key}".`);
    }

    if (!isSqlStorage()) {
        const filePath = path.join(__dirname, "..", "data", dataFiles[key]);
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }

    const result = await (await getPool()).query(
        `SELECT document_value
         FROM app_documents
         WHERE document_key = $1`,
        [key]
    );

    if (!result.rows.length) {
        throw new Error(
            `Required PostgreSQL document "${key}" is missing. Run the JSON import command.`
        );
    }

    return result.rows[0].document_value;
}

async function writeDocument(key, value) {
    if (!dataFiles[key]) {
        throw new Error(`Unknown application data document "${key}".`);
    }

    if (!isSqlStorage()) {
        const filePath = path.join(__dirname, "..", "data", dataFiles[key]);
        fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
        return;
    }

    await (await getPool()).query(
        `INSERT INTO app_documents (document_key, document_value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (document_key)
         DO UPDATE SET
             document_value = EXCLUDED.document_value,
             updated_at = NOW()`,
        [key, JSON.stringify(value)]
    );
}

/** Read-only. Safe to call outside the lock. */
async function getDocument(key) {
    return readDocument(key);
}

/**
 * Write a full document value.
 * Serialized per key so concurrent saves on the same document do not interleave.
 */
async function saveDocument(key, value) {
    return withDocumentLock(key, () => writeDocument(key, value));
}

/**
 * Preferred RMW helper: load → mutate → save under the per-key lock.
 * `mutator` receives the current value and must return the next value to persist.
 * Throw inside mutator to abort the write (nothing is saved).
 */
async function updateDocument(key, mutator) {
    return withDocumentLock(key, async () => {
        if (!isSqlStorage()) {
            const current = await readDocument(key);
            const next = await mutator(current);
            if (next === undefined) {
                throw new Error(`updateDocument("${key}") mutator must return the next document value.`);
            }
            await writeDocument(key, next);
            return next;
        }

        // The in-process queue above orders callers in this app; the row lock below also orders
        // them against any other running copy of the app, so no save can overwrite another.
        const client = await (await getPool()).connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                `SELECT document_value
                 FROM app_documents
                 WHERE document_key = $1
                 FOR UPDATE`,
                [key]
            );

            if (!result.rows.length) {
                throw new Error(
                    `Required PostgreSQL document "${key}" is missing. Run the JSON import command.`
                );
            }

            const next = await mutator(result.rows[0].document_value);
            if (next === undefined) {
                throw new Error(`updateDocument("${key}") mutator must return the next document value.`);
            }

            await client.query(
                `UPDATE app_documents
                 SET document_value = $2::jsonb, updated_at = NOW()
                 WHERE document_key = $1`,
                [key, JSON.stringify(next)]
            );
            await client.query("COMMIT");
            return next;
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* the original error is the useful one */
            }
            throw error;
        } finally {
            client.release();
        }
    });
}

/**
 * Run `task` only if no other copy of the app is already running the same named job.
 * Uses a PostgreSQL advisory lock, so it holds across processes and machines. Returns
 * { ran: false } when another copy holds the lock. With JSON storage there is only one copy, so it just runs.
 */
async function runExclusive(lockName, task) {
    if (!isSqlStorage()) {
        return { ran: true, value: await task() };
    }

    const client = await (await getPool()).connect();
    let locked = false;
    try {
        const result = await client.query(
            "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
            [`alert-system:${lockName}`]
        );
        locked = result.rows[0].locked === true;
        if (!locked) {
            return { ran: false };
        }
        return { ran: true, value: await task() };
    } finally {
        if (locked) {
            try {
                await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`alert-system:${lockName}`]);
            } catch {
                /* the lock is released when this connection closes anyway */
            }
        }
        client.release();
    }
}

async function importDocumentIfMissing(key, value) {
    if (!isSqlStorage()) {
        throw new Error('Set STORAGE_PROVIDER=sql before running the SQL import command.');
    }

    return withDocumentLock(key, async () => {
        const result = await (await getPool()).query(
            `INSERT INTO app_documents (document_key, document_value)
             VALUES ($1, $2::jsonb)
             ON CONFLICT (document_key) DO NOTHING
             RETURNING document_key`,
            [key, JSON.stringify(value)]
        );
        return result.rowCount > 0;
    });
}

async function closeDatabase() {
    if (!pool && !poolPromise) {
        return;
    }

    try {
        const current = pool || (await poolPromise);
        pool = null;
        poolPromise = null;
        if (current) {
            await current.end();
        }
    } catch (error) {
        pool = null;
        poolPromise = null;
        throw error;
    }
}

module.exports = {
    closeDatabase,
    getDocument,
    getPool,
    importDocumentIfMissing,
    isSqlStorage,
    runExclusive,
    initializeDatabase,
    saveDocument,
    updateDocument,
    verifyRequiredDocuments,
    withDocumentLock
};
