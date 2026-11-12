const { getCurrentUser } = require("../currentUser");
const { getUserById } = require("../services/userService");

async function requireLogin(req, res, next) {
    try {
        const userId = req.session && req.session.userId;
        req.currentUser = userId ? await getUserById(userId) : null;

        const currentUser = getCurrentUser(req);

        if (!currentUser || currentUser.active === false) {
            return res.status(401).json({ message: "Please sign in." });
        }

        next();
    } catch (error) {
        console.error("Unable to load authenticated user:", error);
        res.status(500).json({ message: "Unable to verify your sign-in." });
    }
}

module.exports = { requireLogin };