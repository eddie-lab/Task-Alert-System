const express = require("express");
const { getCurrentUser } = require("../currentUser");
const { isAdmin } = require("../services/userService");
const { getTemplates, saveTemplates } = require("../services/templateService");
const { getDomainMap, saveDomainMap } = require("../services/subsidiaryDomainService");

const router = express.Router();


function requireAdmin(req, res, next) {

    const currentUser = getCurrentUser(req);

    if (!isAdmin(currentUser)) {
        return res.status(403).json({ message: "Administrator access required." });
    }

    next();
}


router.use(requireAdmin);


router.get("/email-templates", async (req, res) => {

    try {
        res.json(await getTemplates());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to load email templates" });
    }
});


router.put("/email-templates", async (req, res) => {

    try {

        const { reminder, escalation, dueDate } = req.body;

        if (
            !reminder || !reminder.subject || !reminder.body ||
            !escalation || !escalation.subject || !escalation.body
        ) {
            return res.status(400).json({ message: "The reminder and escalation templates need a subject and body." });
        }

        // dueDate is optional so older clients keep working; if it's
        // omitted the existing due-date template is left untouched.
        if (dueDate !== undefined && (!dueDate || !dueDate.subject || !dueDate.body)) {
            return res.status(400).json({ message: "The due date template needs a subject and body." });
        }

        const existing = await getTemplates();

        await saveTemplates({
            reminder,
            escalation,
            dueDate: dueDate || existing.dueDate
        });

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to save email templates" });
    }
});


router.get("/subsidiary-domains", async (req, res) => {

    try {
        res.json(await getDomainMap());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to load subsidiary domains" });
    }
});


router.put("/subsidiary-domains", async (req, res) => {

    try {

        const domainMap = req.body;

        if (!domainMap || typeof domainMap !== "object" || Array.isArray(domainMap)) {
            return res.status(400).json({ message: "Invalid domain map." });
        }

        for (const [domain, value] of Object.entries(domainMap)) {

            if (typeof value === "string" && value.trim()) {
                continue;
            }

            if (
                value && typeof value === "object" &&
                value.ambiguous === true &&
                typeof value.question === "string" && value.question.trim() &&
                Array.isArray(value.options) &&
                value.options.length >= 2
            ) {
                continue;
            }

            return res.status(400).json({ message: `Invalid entry for domain "${domain}".` });
        }

        await saveDomainMap(domainMap);

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to save subsidiary domains" });
    }
});


module.exports = router;