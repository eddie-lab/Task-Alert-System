const express = require("express");
const { getCurrentUser } = require("../currentUser");
const { isAdmin, getUsers, getUserById, updateUser } = require("../services/userService");

const router = express.Router();


function requireAdmin(req, res, next) {

    const currentUser = getCurrentUser(req);

    if (!isAdmin(currentUser)) {
        return res.status(403).json({ message: "Administrator access required." });
    }

    next();
}

router.use(requireAdmin);


function publicView(user) {

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        subsidiary: user.subsidiary,
        active: user.active !== false
    };
}


/* =========================================================
   LIST ALL USERS
========================================================= */

router.get("/", async (req, res) => {

    try {
        res.json((await getUsers()).map(publicView));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to load users" });
    }
});


/* =========================================================
   CHANGE A USER'S ROLE AND/OR ACTIVE STATUS
========================================================= */

router.patch("/:id", async (req, res) => {

    try {

        const currentUser = getCurrentUser(req);

        const target = await getUserById(req.params.id);

        if (!target) {
            return res.status(404).json({ message: "User not found." });
        }

        if (target.id === currentUser.id) {
            return res.status(400).json({
                message: "You can't change your own role or status. Ask another administrator."
            });
        }

        const { role, active } = req.body;

        const changes = {};

        if (role !== undefined) {

            if (role !== "Administrator" && role !== "User") {
                return res.status(400).json({ message: "Invalid role." });
            }

            changes.role = role;
        }

        if (active !== undefined) {

            if (typeof active !== "boolean") {
                return res.status(400).json({ message: "Invalid status." });
            }

            changes.active = active;
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({ message: "Nothing to update." });
        }

        const newRole = changes.role !== undefined ? changes.role : target.role;
        const newActive = changes.active !== undefined ? changes.active : target.active !== false;

        // A regular user needs a subsidiary (alerts are created under it).
        if (newRole === "User" && !target.subsidiary) {
            return res.status(400).json({
                message: "This user has no subsidiary on record, so they can't be a regular user."
            });
        }

        // Never allow the last active administrator to be removed.
        const activeAdminsAfter = (await getUsers()).filter(user => {

            const userRole = user.id === target.id ? newRole : user.role;
            const userActive = user.id === target.id ? newActive : user.active !== false;

            return userRole === "Administrator" && userActive;

        }).length;

        if (activeAdminsAfter === 0) {
            return res.status(400).json({
                message: "There must always be at least one active administrator."
            });
        }

        res.json(publicView(await updateUser(target.id, changes)));

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to update user" });
    }
});


module.exports = router;