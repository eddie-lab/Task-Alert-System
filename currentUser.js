function getCurrentUser(req) {
    return req.currentUser || null;
}

module.exports = { getCurrentUser };