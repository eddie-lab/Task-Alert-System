const express = require("express");
const path = require("path");
require("dotenv").config();
const {
    closeDatabase,
    getPool,
    initializeDatabase,
    isSqlStorage,
    verifyRequiredDocuments
} = require("./services/database");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const session = require("express-session");
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
    if (isProduction) {
        throw new Error("SESSION_SECRET must be set when NODE_ENV=production.");
    }
    console.warn("SESSION_SECRET is not set. Using an insecure development secret.");
}

// Behind a reverse proxy or HTTPS load balancer, set TRUST_PROXY=1 (and COOKIE_SECURE=true for HTTPS).
if (process.env.TRUST_PROXY) {
    const trust = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isNaN(trust) ? process.env.TRUST_PROXY : trust);
}

const sessionOptions = {
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
        httpOnly: true,
        sameSite: "lax",
        secure: String(process.env.COOKIE_SECURE).toLowerCase() === "true"
    }
};

// With PostgreSQL, sessions live in the database, so a restart does not sign everyone out.
// The store is attached lazily: the pool only exists once the database has been checked at startup.
let sessionStore = null;
const sessionHandlerWithoutStore = session(sessionOptions);
let sessionHandler = sessionHandlerWithoutStore;
app.use((req, res, next) => sessionHandler(req, res, next));

//  API
const { requireLogin } = require("./middleware/requireLogin");
const alertsRouter = require("./routes/alert");
app.use("/api/alerts", requireLogin, alertsRouter);

//dashboard
const dashboardRouter = require("./routes/dashboard");
app.use("/api/dashboard", requireLogin, dashboardRouter);

//scheduler
const { startScheduler, stopScheduler } = require("./scheduler/alertProcessor");

//user
const userRouter = require("./routes/user");
app.use("/api/users", requireLogin, userRouter);

//auth
const { router: authRouter } = require("./routes/auth");
app.use("/api/auth", authRouter);

//settings
const settingsRouter = require("./routes/settings");
app.use("/api/settings", requireLogin, settingsRouter);

//admin users
const adminUsersRouter = require("./routes/adminUsers");
app.use("/api/admin/users", requireLogin, adminUsersRouter);


// frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        message: "Alert System API is running"
    });
});

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

async function startServer() {
    await initializeDatabase();
    await verifyRequiredDocuments();

    if (isSqlStorage()) {
        const PgSession = require("connect-pg-simple")(session);
        sessionStore = new PgSession({
            pool: await getPool(),
            tableName: "user_sessions",
            createTableIfMissing: true
        });
        sessionHandler = session({ ...sessionOptions, store: sessionStore });
    }

    const server = app.listen(PORT, () => {
        console.log(`Alert System running on http://localhost:${PORT}`);
        startScheduler();
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => {
            stopScheduler();
            server.close(async error => {
                if (error) {
                    console.error("Unable to stop the HTTP server cleanly:", error);
                    process.exitCode = 1;
                }

                try {
                    await closeDatabase();
                } catch (closeError) {
                    console.error("Unable to close the database connection:", closeError);
                    process.exitCode = 1;
                }
            });
        });
    }
}

if (require.main === module) {
    startServer().catch(async error => {
        console.error("Unable to start Alert System:", error);
        try {
            await closeDatabase();
        } catch (closeError) {
            console.error("Unable to close the database connection:", closeError);
        }
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };