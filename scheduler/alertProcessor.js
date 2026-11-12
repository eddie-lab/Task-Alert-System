const { processAlerts } = require("../services/alertSchedulingService");
const { runExclusive } = require("../services/database");

const CHECK_INTERVAL_MS = 60 * 1000;
let interval = null;

function runSchedulerCycle() {
    // Only one running copy of the app checks alerts at a time, so reminders are never sent twice.
    runExclusive("scheduler", processAlerts).catch(error => {
        console.error("Alert scheduler failed:", error);
    });
}

function startScheduler() {
    if (interval) {
        return;
    }

    if (String(process.env.SCHEDULER_ENABLED).toLowerCase() === "false") {
        console.log("Alert scheduler is off on this instance (SCHEDULER_ENABLED=false)");
        return;
    }

    console.log(`Alert scheduler started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);

    runSchedulerCycle();
    interval = setInterval(runSchedulerCycle, CHECK_INTERVAL_MS);
}

function stopScheduler() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}

module.exports = {
    startScheduler,
    stopScheduler,
    processAlerts
};
