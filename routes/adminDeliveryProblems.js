const express = require("express");
const { getCurrentUser } = require("../currentUser");
const { isAdmin } = require("../services/userService");
const { getDocument, updateDocument } = require("../services/database");
const { resendDeliveryProblem } = require("../services/emailService");

const router = express.Router();

router.use((req, res, next) => {
    if (!isAdmin(getCurrentUser(req))) {
        return res.status(403).json({ message: "Administrator access required." });
    }
    next();
});

router.get("/", async (_req, res) => {
    try {
        const problems = await getDocument("deliveryProblems");
        res.json(problems.map(({ body, ...problem }) => problem));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to load delivery problems." });
    }
});

router.post("/:id/resend", async (req, res) => {
    try {
        const problems = await getDocument("deliveryProblems");
        const problem = problems.find(item => item.id === req.params.id);
        if (!problem) return res.status(404).json({ message: "Delivery problem not found." });

        try {
            await resendDeliveryProblem(problem);
        } catch (error) {
            await updateDocument("deliveryProblems", current => current.map(item => item.id === problem.id
                ? { ...item, attempts: (item.attempts || 0) + 1, error: error.message || "Email delivery failed", lastAttemptAt: new Date().toISOString() }
                : item));
            return res.status(502).json({ message: error.message || "Email could not be resent." });
        }

        await updateDocument("deliveryProblems", current => current.filter(item => item.id !== problem.id));
        res.json({ message: "Email resent successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to resend this email." });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        let removed = false;
        await updateDocument("deliveryProblems", problems => {
            const next = problems.filter(item => item.id !== req.params.id);
            removed = next.length !== problems.length;
            return next;
        });
        if (!removed) return res.status(404).json({ message: "Delivery problem not found." });
        res.json({ message: "Delivery problem discarded." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to discard this delivery problem." });
    }
});

module.exports = router;
