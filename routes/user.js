const express = require("express");
const { getCurrentUser } = require("../currentUser");
const { getAssignableUsers } = require("../services/userService");

const router = express.Router();


router.get("/me", (req, res) => {

    try {

        const currentUser = getCurrentUser(req);

        res.json(currentUser);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to retrieve current user"
        });
    }
});

router.get("/assignable", async (req, res) => {

    try {

        const users = (await getAssignableUsers()).map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            subsidiary: user.subsidiary
        }));

        res.json(users);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Unable to retrieve users"
        });
    }
});


module.exports = router;