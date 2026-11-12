const { getDocument, saveDocument } = require("./database");

   //DATA FUNCTIONS


async function getUsers() {
    return getDocument("users");
}


async function getUserById(id) {

    return (await getUsers()).find(
        user => user.id === id
    ) || null;
}


async function getUserByEmail(email) {

    if (!email) {
        return null;
    }

    return (await getUsers()).find(
        user =>
            user.email.toLowerCase() ===
            String(email).toLowerCase()
    ) || null;
}

async function emailExists(email) {

    return !!(await getUserByEmail(email));
}


function generateUserId(users) {

    const maxNum = users.reduce((max, user) => {

        const match = /USR-(\d+)/.exec(user.id);

        const num = match ? parseInt(match[1], 10) : 0;

        return Math.max(max, num);

    }, 0);

    return `USR-${String(maxNum + 1).padStart(6, "0")}`;
}

async function updateUser(id, changes) {

    const users = await getUsers();

    const index = users.findIndex(user => user.id === id);

    if (index === -1) {
        return null;
    }

    users[index] = {
        ...users[index],
        ...changes,
        id: users[index].id,
        email: users[index].email
    };

    await saveDocument("users", users);

    return users[index];
}


//CREATE A NEW USER (SIGNUP)


async function createUser({ name, email, subsidiary }) {

    const users = await getUsers();

    const role = users.length === 0 ? "Administrator" : "User";

    const newUser = {
        id: generateUserId(users),
        name,
        email,
        role,
        subsidiary: role === "Administrator" ? null : subsidiary,
        active: true
    };

    users.push(newUser);

    await saveDocument("users", users);

    return newUser;
}


   //ROLE HELPERS


function isAdmin(user) {

    return !!user && user.role === "Administrator";
}

async function getAssignableUsers() {

    return (await getUsers()).filter(user => user.active !== false);
}


function canManageAlert(user, alert) {

    if (isAdmin(user)) {
        return true;
    }

    if (!alert) {
        return false;
    }

    return (
        alert.createdByUserId === user.id ||
        (alert.ownerUserIds || []).includes(user.id)
    );
}


module.exports = {
    getUsers,
    getUserById,
    getUserByEmail,
    isAdmin,
    canManageAlert,
    getAssignableUsers,
    emailExists,
    createUser,
    updateUser
};