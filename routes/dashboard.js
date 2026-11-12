const express = require("express");
const { getDocument } = require("../services/database");

const { getCurrentUser } = require("../currentUser");
const {
    isOverdueAlert,
    getVisibleDashboardAlerts
} = require("../services/dashboardService");

const router = express.Router();

// ==============================
// DASHBOARD SUMMARY
// ==============================

router.get("/", async (req, res) => {

    try {

        const currentUser = getCurrentUser(req);

        // Apply the user visibility scope before the optional subsidiary filter.
        // Regular users can filter their own/collaborated alerts, not other users' alerts.
        const requestedSubsidiary = typeof req.query.subsidiary === "string"
            ? req.query.subsidiary.trim()
            : "";
        const alerts = getVisibleDashboardAlerts(
            await getDocument("alerts"),
            currentUser,
            requestedSubsidiary
        );

        const now = new Date();

        const today =
            now.toISOString().split("T")[0];


        // Active alerts
        const activeStatuses = [
                                "Pending",
                                "Reminder Sent",
                                "Overdue",
                                "Escalated",
                                "Post-Due Reminder Sent"
                            ];

        const activeAlerts =
                            alerts.filter(alert =>
                            alert.active === true &&
                            activeStatuses.includes(alert.status)
                        );


        // Due today
        const dueToday =
            activeAlerts.filter(alert => {

                if (!alert.dueDate) {
                    return false;
                }

                return alert.dueDate.substring(0, 10) === today;
            });


        // Overdue
        const overdue = activeAlerts.filter(alert => isOverdueAlert(alert, now));


        // Escalated
        const escalated =
            activeAlerts.filter(alert =>
                alert.status === "Escalated"
            );


        // Completed
        const completed =
            alerts.filter(alert =>
                alert.status === "Completed"
            );



        res.json({

            total: activeAlerts.length,

            dueToday: dueToday.length,

            overdue: overdue.length,

            escalated: escalated.length,

            completed: completed.length

        });

    } catch (error) {

        console.error(
            "Dashboard error:",
            error
        );

        res.status(500).json({
            message:
                "Unable to load dashboard"
        });
    }
});


module.exports = router;