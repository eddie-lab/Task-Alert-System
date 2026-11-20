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
const useSqlStorage = isSqlStorage();

if (!process.env.SESSION_SECRET) {
    if (isProduction) {
        throw new Error("SESSION_SECRET must be set when NODE_ENV=production.");
    }
    console.warn("SESSION_SECRET is not set. Using an insecure development secret.");
}

if (isProduction && !useSqlStorage) {
    throw new Error("STORAGE_PROVIDER=sql is required in production so sessions use PostgreSQL instead of MemoryStore.");
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

// JSON storage is for local development; production sessions use PostgreSQL.
let sessionStore = null;
let sessionHandler = useSqlStorage ? null : session(sessionOptions);
app.use((req, res, next) => {
    if (!sessionHandler) {
        return next(new Error("Session store has not been initialized."));
    }
    return sessionHandler(req, res, next);
});

//  API
const { requireLogin } = require("./middleware/requireLogin");
const alertsRouter = require("./routes/alert");
app.use("/api/alerts", requireLogin, alertsRouter);

//dashboard
const dashboardRouter = require("./routes/dashboard");
app.use("/api/dashboard", requireLogin, dashboardRouter);

//scheduler
const { startScheduler, stopScheduler } = require("./scheduler/alertProcessor");
const { verifyEmailConnection } = require("./services/emailService");

//user
const userRouter = require("./routes/user");
app.use("/api/users", requireLogin, userRouter);

//auth
const { router: authRouter } = require("./routes/auth");
app.use("/api/auth", authRouter);

const { getUserById } = require("./services/userService");

//settings
const settingsRouter = require("./routes/settings");
app.use("/api/settings", requireLogin, settingsRouter);

//admin users
const adminUsersRouter = require("./routes/adminUsers");
app.use("/api/admin/users", requireLogin, adminUsersRouter);

const adminDeliveryProblemsRouter = require("./routes/adminDeliveryProblems");
app.use("/api/admin/delivery-problems", requireLogin, adminDeliveryProblemsRouter);

app.get(["/", "/index.html"], async (req, res, next) => {
    try {
        const userId = req.session && req.session.userId;
        const user = userId ? await getUserById(userId) : null;

        if (!user) {
            return res.redirect("/signup.html");
        }

        if (user.active === false) {
            return res.redirect(
                "/signup.html?error=" +
                encodeURIComponent("Your account has been deactivated. Please contact an administrator.")
            );
        }

        return res.sendFile(path.join(__dirname, "public", "index.html"));
    } catch (error) {
        return next(error);
    }
});

// frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        message: "Alert System API is running"
    });
});

async function startServer() {
    await initializeDatabase();
    await verifyRequiredDocuments();

    if (useSqlStorage) {
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
        verifyEmailConnection().catch(() => {});
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
