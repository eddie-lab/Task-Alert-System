const express = require("express");
const { getDocument, saveDocument } = require("../services/database");

const { getCurrentUser } = require("../currentUser");
const { isAdmin, canManageAlert } = require("../services/userService");
const { validateReminderRepeat } = require("../services/reminderSchedule");
const {
    calculateNextDueDate,
    calculateReminderDate,
    calculateEscalationDate
} = require("../services/alertSchedulingService");
const { validateAlertInput } = require("../services/alertValidation");

const router = express.Router();

//DATA FUNCTIONS


async function getAlerts() {
    return getDocument("alerts");
}


async function saveAlerts(alerts) {
    await saveDocument("alerts", alerts);
}



   //ID GENERATOR


function generateAlertId(alerts) {

    let maxNumber = 0;

    alerts.forEach(alert => {

        if (!alert.id) {
            return;
        }

        const match = alert.id.match(/^ALT-(\d+)$/);

        if (match) {

            const number = parseInt(match[1], 10);

            if (number > maxNumber) {
                maxNumber = number;
            }
        }
    });

    return `ALT-${String(maxNumber + 1).padStart(6, "0")}`;
}


/* =========================================================
   GET ALL ALERTS
========================================================= */

router.get("/", async (req, res) => {

    try {

        const currentUser = getCurrentUser(req);
        const allAlerts = await getAlerts();
        const alerts = isAdmin(currentUser)
            ? allAlerts
            : allAlerts.filter(
                alert => alert.createdByUserId === currentUser.id ||
                (alert.ownerUserIds || []).includes(currentUser.id)
            );

        res.json(alerts);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to retrieve alerts"
        });
    }
});


/* =========================================================
   GET SINGLE ALERT
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const alert = alerts.find(
            x => x.id === req.params.id
        );

        // Same visibility rule as the list: creator, owners, or an
        // administrator.
        // so alert IDs can't be probed to learn which ones exist.
        if (!alert || !canManageAlert(currentUser, alert)) {

            return res.status(404).json({
                message: "Alert not found"
            });
        }

        res.json(alert);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to retrieve alert"
        });
    }
});


/* =========================================================
   CREATE ALERT
========================================================= */

router.post("/", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const subsidiary = isAdmin(currentUser)
            ? req.body && req.body.subsidiary
            : currentUser.subsidiary;

        const validation = await validateAlertInput({
            ...(req.body && typeof req.body === "object" && !Array.isArray(req.body)
                ? req.body
                : {}),
            subsidiary
        });

        if (validation.error) {
            return res.status(400).json({ message: validation.error });
        }

        const alertInput = validation.value;
        const repeatError = validateReminderRepeat(alertInput);
        if (repeatError) {
            return res.status(400).json({ message: repeatError });
        }

        const newAlert = {
            id: generateAlertId(alerts),
            ...alertInput,
            createdBy: currentUser.name,
            createdByEmail: currentUser.email,
            createdByUserId: currentUser.id,
            status: "Pending",
            active: true,
            postDueReminderDate: null,
            postDueReminderSent: false,
            dueNoticeSent: false
        };

        newAlert.reminderDate =
            calculateReminderDate(
                newAlert.dueDate,
                newAlert.reminderValue,
                newAlert.reminderUnit
            );


        if (
            newAlert.escalationEnabled
        ) {

            newAlert.escalationDate =
                calculateEscalationDate(
                    newAlert.dueDate,
                    newAlert.escalationValue,
                    newAlert.escalationUnit
                );

        } else {

            newAlert.escalationDate = null;
        }


        newAlert.reminderSent = false;

        newAlert.escalationSent = false;

        newAlert.dueNoticeSent = false;

        newAlert.completedDate = null;

        newAlert.completedBy = null;

        newAlert.previousOccurrenceId = null;

        newAlert.nextOccurrenceId = null;

        alerts.push(newAlert);

        await saveAlerts(alerts);

        res.status(201).json(newAlert);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to create alert"
        });
    }
});


/* =========================================================
   MARK ALERT AS COMPLETED
   AND CREATE NEXT OCCURRENCE
========================================================= */

router.post("/:id/complete", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const index = alerts.findIndex(
            x => x.id === req.params.id
        );


        if (index === -1) {

            return res.status(404).json({
                message: "Alert not found"
            });
        }
        const currentAlert = alerts[index];

        if (!canManageAlert(currentUser, currentAlert)) {

            return res.status(403).json({
                message: "You do not have permission to complete this alert"
            });
        }

        if (!currentAlert.active || currentAlert.status === "Cancelled") {
            return res.status(400).json({
                    error: "Cancelled or inactive alerts cannot be completed."
            });
        }


        /*
         * Prevent completing an already completed alert
         */

        if (currentAlert.status === "Completed") {

            return res.status(400).json({
                message: "Alert has already been completed"
            });
        }


        /*
         * Mark current occurrence as completed
         */

        currentAlert.status = "Completed";

        currentAlert.completedDate =
            new Date().toISOString();

        currentAlert.completedBy =
             currentUser.name;


        /*
         * Calculate next due date
         */

        const nextDueDate =
            calculateNextDueDate(
                currentAlert.dueDate,
                currentAlert.frequencyValue,
                currentAlert.frequencyUnit
            );


        
        //Calculate reminder date for new occurence
        

        const nextReminderDate =
            calculateReminderDate(
                nextDueDate,
                currentAlert.reminderValue,
                currentAlert.reminderUnit
            );


        
        //Calculate escalation date for the NEW occurrence
         

        let nextEscalationDate = null;


        if (
            currentAlert.escalationEnabled === true ||
            currentAlert.escalationEnabled === "true"
        ) {

            nextEscalationDate =
                calculateEscalationDate(
                    nextDueDate,
                    currentAlert.escalationValue,
                    currentAlert.escalationUnit
                );
        }


        /*
         * Generate ID for next occurrence
         */

        const nextAlertId =
            generateAlertId(alerts);


        /*
         * Create next occurrence
         */

        const nextAlert = {

            ...currentAlert,

            id: nextAlertId,

            dueDate: nextDueDate,

            reminderDate: nextReminderDate,

            escalationDate: nextEscalationDate,

            status: "Pending",

            reminderSent: false,

            escalationSent: false,

            completedDate: null,

            completedBy: null,

            previousOccurrenceId: currentAlert.id,

            nextOccurrenceId: null,

            postDueReminderDate: null,
            postDueReminderSent: false,
            dueNoticeSent: false
        };


        /*
         * Link current occurrence
         * to the next occurrence
         */

        currentAlert.nextOccurrenceId =
            nextAlert.id;


        /*
         * Add next occurrence
         */

        alerts.push(nextAlert);


        /*
         * Save everything
         */

        await saveAlerts(alerts);


        /*
         * Return both records
         */

        res.json({

            message:
                "Alert completed and next occurrence created",

            completedAlert:
                currentAlert,

            nextAlert:
                nextAlert
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            message:
                "Unable to complete alert"
        });
    }
});


// Edit alert

router.put("/:id", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const index = alerts.findIndex(
            x => x.id === req.params.id
        );

        if (index === -1) {

            return res.status(404).json({
                message: "Alert not found"
            });
        }

        const currentAlert = alerts[index];

        if (!canManageAlert(currentUser, currentAlert)) {

            return res.status(403).json({
                message: "You do not have permission to edit this alert"
            });
        }

        if (currentAlert.status === "Completed") {

            return res.status(400).json({
                message:
                    "Completed alerts cannot be edited"
            });
        }

        const subsidiary = isAdmin(currentUser)
            ? (req.body && req.body.subsidiary) || currentAlert.subsidiary
            : currentAlert.subsidiary;
        const validation = await validateAlertInput({
            ...currentAlert,
            ...(req.body && typeof req.body === "object" && !Array.isArray(req.body)
                ? req.body
                : {}),
            subsidiary
        });

        if (validation.error) {
            return res.status(400).json({ message: validation.error });
        }

        const updatedAlert = {
            ...currentAlert,
            ...validation.value,
            id: currentAlert.id,
            status: currentAlert.status,
            active: true,
            createdBy: currentAlert.createdBy,
            createdByEmail: currentAlert.createdByEmail,
            createdByUserId: currentAlert.createdByUserId
        };

        const repeatError = validateReminderRepeat(updatedAlert);

        if (repeatError) {

            return res.status(400).json({ message: repeatError });
        }

        // Recalculate reminder date
        updatedAlert.reminderDate =
            calculateReminderDate(
                updatedAlert.dueDate,
                updatedAlert.reminderValue,
                updatedAlert.reminderUnit
            );

        // Recalculate escalation date
        if (
            updatedAlert.escalationEnabled === true ||
            updatedAlert.escalationEnabled === "true"
        ) {

            updatedAlert.escalationDate =
                calculateEscalationDate(
                    updatedAlert.dueDate,
                    updatedAlert.escalationValue,
                    updatedAlert.escalationUnit
                );

        } else {

            updatedAlert.escalationDate = null;
        }

        // Reset notification flags
        updatedAlert.reminderSent = false;
        updatedAlert.escalationSent = false;
        updatedAlert.dueNoticeSent = false;

        alerts[index] = updatedAlert;

        await saveAlerts(alerts);

        res.json(updatedAlert);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to update alert"
        });
    }
});

// Deactivate alert
router.post("/:id/deactivate", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const index = alerts.findIndex(
            x => x.id === req.params.id
        );

        if (index === -1) {

            return res.status(404).json({
                message: "Alert not found"
            });
        }

        if (!canManageAlert(currentUser, alerts[index])) {

            return res.status(403).json({
                message: "You do not have permission to cancel this alert"
            });
        }

        alerts[index].active = false;

        alerts[index].status = "Cancelled";

        alerts[index].cancelledDate =
            new Date().toISOString();

        alerts[index].cancelledBy =
            currentUser.name;

        await saveAlerts(alerts);

        res.json(alerts[index]);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to deactivate alert"
        });
    }
});

// Reactivate alert
router.post("/:id/reactivate", async (req, res) => {

    try {

        const alerts = await getAlerts();

        const currentUser = getCurrentUser(req);

        const index = alerts.findIndex(
            x => x.id === req.params.id
        );

        if (index === -1) {

            return res.status(404).json({
                message: "Alert not found"
            });
        }

        if (!canManageAlert(currentUser, alerts[index])) {

            return res.status(403).json({
                message: "You do not have permission to reactivate this alert"
            });
        }

        alerts[index].active = true;

        alerts[index].status = "Pending";

        alerts[index].cancelledDate = null;

        alerts[index].cancelledBy = null;

        await saveAlerts(alerts);

        res.json(alerts[index]);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to reactivate alert"
        });
    }
});


module.exports = router;