const express = require("express");
const { getDocument, saveDocument } = require("../services/database");

const { getCurrentUser } = require("../currentUser");
const { isAdmin, canManageAlert, canViewAlert } = require("../services/userService");
const { validateReminderRepeat } = require("../services/reminderSchedule");
const {
    calculateNextDueDate,
    calculateReminderDate,
    calculateEscalationDate
} = require("../services/alertSchedulingService");
const { validateAlertInput } = require("../services/alertValidation");
const { sendCompletedEmail } = require("../services/emailService");
const { getDomainMap } = require("../services/subsidiaryDomainService");
const multer = require("multer");
const {
    buildTemplateBuffer,
    parseWorkbook
} = require("../services/alertImportService");

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
    fileFilter: (_req, file, cb) => {
        const name = String(file.originalname || "").toLowerCase();
        // .xlsm (macro) files are rejected — template is plain .xlsx only
        if (name.endsWith(".xlsx")) {
            cb(null, true);
            return;
        }
        cb(new Error("Upload an Excel .xlsx file (download the template first)."));
    }
});

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

function attachScheduleFields(alert) {
    alert.reminderDate = calculateReminderDate(
        alert.dueDate,
        alert.reminderValue,
        alert.reminderUnit
    );
    if (alert.escalationEnabled) {
        alert.escalationDate = calculateEscalationDate(
            alert.dueDate,
            alert.escalationValue,
            alert.escalationUnit
        );
    } else {
        alert.escalationDate = null;
    }
    alert.reminderSent = false;
    alert.escalationSent = false;
    alert.dueNoticeSent = false;
    alert.completedDate = null;
    alert.completedBy = null;
    alert.previousOccurrenceId = null;
    alert.nextOccurrenceId = null;
    alert.postDueReminderDate = null;
    alert.postDueReminderSent = false;
    return alert;
}

function createAlertRecord(alertInput, currentUser, alerts) {
    const newAlert = {
        id: generateAlertId(alerts),
        ...alertInput,
        createdBy: currentUser.name,
        createdByEmail: currentUser.email,
        createdByUserId: currentUser.id,
        status: "Pending",
        active: true
    };
    return attachScheduleFields(newAlert);
}


/* =========================================================
   GET ALL ALERTS
========================================================= */

router.get("/", async (req, res) => {

    try {

        const currentUser = getCurrentUser(req);
        const allAlerts = await getAlerts();
        const alerts = allAlerts.filter(alert => canViewAlert(currentUser, alert));

        res.json(alerts);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to retrieve alerts"
        });
    }
});

router.get("/subsidiaries", async (_req, res) => {
    try {
        const domainMap = await getDomainMap();
        const subsidiaries = [...new Set(Object.values(domainMap).flatMap(entry => {
            if (typeof entry === "string") return [entry];
            return entry && entry.ambiguous && Array.isArray(entry.options)
                ? entry.options
                : [];
        }))].sort((a, b) => a.localeCompare(b));
        res.json(subsidiaries);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to retrieve allowed subsidiaries." });
    }
});


/* =========================================================
   DOWNLOAD EXCEL TEMPLATE (must be before /:id)
========================================================= */

router.get("/template", async (req, res) => {
    try {
        const buffer = await buildTemplateBuffer();
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="alert-import-template.xlsx"'
        );
        res.send(Buffer.from(buffer));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to build the template." });
    }
});


/* =========================================================
   BATCH IMPORT FROM EXCEL
========================================================= */

router.post("/import", (req, res) => {
    upload.single("file")(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({
                message: uploadError.message || "Unable to read the uploaded file."
            });
        }

        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({
                    message: "Choose an Excel .xlsx file to upload."
                });
            }

            const currentUser = getCurrentUser(req);
            const forcedSubsidiary = isAdmin(currentUser)
                ? null
                : currentUser.subsidiary;

            const parsed = await parseWorkbook(req.file.buffer, {
                forcedSubsidiary,
                creatorEmail: currentUser.email
            });
            if (parsed.error) {
                return res.status(400).json({ message: parsed.error });
            }

            const alerts = await getAlerts();
            if (!Array.isArray(alerts)) {
                return res.status(500).json({ message: "Unable to load existing alerts." });
            }
            const created = [];
            const failed = [];

            for (const item of parsed.results) {
                if (!item.ok) {
                    failed.push({ row: item.row, error: item.error });
                    continue;
                }
                // Non-admins always create under their subsidiary
                const input = forcedSubsidiary
                    ? { ...item.value, subsidiary: forcedSubsidiary }
                    : item.value;
                try {
                    const record = createAlertRecord(input, currentUser, alerts);
                    alerts.push(record);
                    created.push({
                        row: item.row,
                        id: record.id,
                        name: record.name
                    });
                } catch (rowError) {
                    failed.push({
                        row: item.row,
                        error: rowError.message || "Unable to create this alert."
                    });
                }
            }

            if (created.length) {
                await saveAlerts(alerts);
            }

            return res.status(created.length ? 201 : 400).json({
                message: created.length
                    ? `Created ${created.length} alert${created.length === 1 ? "" : "s"}${failed.length ? `; ${failed.length} row${failed.length === 1 ? "" : "s"} failed` : ""}.`
                    : "No alerts were created. Fix the row errors and try again.",
                created,
                failed
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: "Unable to import alerts." });
        }
    });
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

        // Same read visibility rule as the list, including enabled
        // escalation recipients.
        // so alert IDs can't be probed to learn which ones exist.
        if (!alert || !canViewAlert(currentUser, alert)) {

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

        const newAlert = createAlertRecord(alertInput, currentUser, alerts);
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
         * Tell the collaborators this alert is done (not the person who
         * completed it). A mail problem must never undo the completion.
         */

        sendCompletedEmail(currentAlert, {
            excludeEmails: [currentUser.email]
        }).catch(error => {
            console.error(
                `Failed to send completion notice for ${currentAlert.id}:`,
                error.message
            );
        });


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


// Delete alert (permanent)
router.delete("/:id", async (req, res) => {

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
                message: "You do not have permission to delete this alert"
            });
        }

        const [removed] = alerts.splice(index, 1);

        await saveAlerts(alerts);

        res.json({
            message: "Alert deleted",
            id: removed.id
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to delete alert"
        });
    }
});


module.exports = router;
