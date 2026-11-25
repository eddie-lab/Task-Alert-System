const express = require("express");
const msal = require("@azure/msal-node");

const { resolveSubsidiary } = require("../services/subsidiaryDomainService");
const { emailExists, createUser, getUserByEmail } = require("../services/userService");

const router = express.Router();

const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const AUTH_TENANT = process.env.MS_AUTH_TENANT || "common";
const REDIRECT_URI = process.env.MS_REDIRECT_URI;

const isConfigured = !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

let msalClient = null;

if (isConfigured) {

    msalClient = new msal.ConfidentialClientApplication({
        auth: {
            clientId: CLIENT_ID,
            authority: `https://login.microsoftonline.com/${AUTH_TENANT}`,
            clientSecret: CLIENT_SECRET
        }
    });
}

const SCOPES = ["openid", "profile", "email", "User.Read"];


/* =========================================================
   START LOGIN - REDIRECT TO MICROSOFT
========================================================= */

router.get("/login", async (req, res) => {

    if (!isConfigured) {

        return res.redirect(
            "/signup.html?error=" +
            encodeURIComponent(
                "Microsoft sign-in isn't configured yet."
            )
        );
    }

    try {

        const authUrl = await msalClient.getAuthCodeUrl({
            scopes: SCOPES,
            redirectUri: REDIRECT_URI
        });

        // Send the browser to Microsoft with a small page instead of a 302.
        // Some hosts and reverse proxies rewrite the Location header of a
        // redirect so it points back at this site ("Cannot GET /<tenant>/oauth2/...").
        // A page that navigates by itself is not touched by them.
        const safe = String(authUrl).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        res.set("Cache-Control", "no-store");
        res.status(200).type("html").send(
            '<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title>' +
            '<meta http-equiv="refresh" content="0;url=' + safe + '"></head>' +
            '<body><p>Taking you to Microsoft… <a href="' + safe + '">Continue</a></p>' +
            '<script>location.replace(' + JSON.stringify(String(authUrl)).replace(/</g, "\\u003c") + ');</script></body></html>'
        );

    } catch (error) {

        console.error(error);

        res.redirect(
            "/signup.html?error=" + encodeURIComponent("Unable to start Microsoft sign-in.")
        );
    }
});


/* =========================================================
   CALLBACK - MICROSOFT SENDS THE USER BACK HERE
========================================================= */

router.get("/callback", async (req, res) => {

    if (!isConfigured) {
        return res.redirect("/signup.html?error=" + encodeURIComponent("Microsoft sign-in isn't configured yet."));
    }

    try {

        const tokenResponse = await msalClient.acquireTokenByCode({
            code: req.query.code,
            scopes: SCOPES,
            redirectUri: REDIRECT_URI
        });

        const email = tokenResponse.account.username;
        const name = tokenResponse.account.name || email;

        let user = await getUserByEmail(email);

        if (user && user.active === false) {

            return res.redirect(
                "/signup.html?error=" +
                encodeURIComponent("Your account has been deactivated. Please contact an administrator.")
            );
        }

        if (!user) {

            const resolution = await resolveSubsidiary(email);

            if (!resolution.allowed) {

                return res.redirect(
                    "/signup.html?error=" +
                    encodeURIComponent("This email domain is not authorized to sign up.")
                );
            }

            if (resolution.ambiguous) {

                req.session.pendingSignup = { name, email };

                return res.redirect(
                    "/signup.html?needsSubsidiary=1"
                );
            }

            user = await createUser({ name, email, subsidiary: resolution.subsidiary });
        }

        req.session.userId = user.id;

        res.redirect("/");

    } catch (error) {

        console.error(error);

        res.redirect("/signup.html?error=" + encodeURIComponent("Sign-in failed. Please try again."));
    }
});

router.get("/signup-options", async (req, res) => {
    try {
        const pendingSignup = req.session && req.session.pendingSignup;
        if (!pendingSignup || !pendingSignup.email) {
            return res.status(400).json({ message: "No signup is waiting for subsidiary selection." });
        }

        const resolution = await resolveSubsidiary(pendingSignup.email);
        if (!resolution.allowed || !resolution.ambiguous) {
            return res.status(400).json({ message: "No subsidiary choices are configured for this signup." });
        }

        res.set("Cache-Control", "no-store");
        res.json({ question: resolution.question, options: resolution.options });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Unable to load subsidiary choices." });
    }
});


/* =========================================================
   COMPLETE SIGNUP AFTER CHOOSING AN AMBIGUOUS SUBSIDIARY
========================================================= */

router.post("/complete-signup", async (req, res) => {

    try {

        const pending = req.session.pendingSignup;

        if (!pending) {
            return res.status(400).json({ message: "No signup in progress." });
        }

        const resolution = await resolveSubsidiary(pending.email, req.body.subsidiary);

        if (!resolution.allowed || resolution.ambiguous) {
            return res.status(400).json({ message: "Invalid subsidiary selection." });
        }

        const user = await createUser({
            name: pending.name,
            email: pending.email,
            subsidiary: resolution.subsidiary
        });

        delete req.session.pendingSignup;

        req.session.userId = user.id;

        res.json({ success: true });

    } catch (error) {

        console.error(error);

        res.status(500).json({ message: "Unable to complete signup" });
    }
});


/* =========================================================
   LOGOUT
========================================================= */

router.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/signup.html");
    });
});


module.exports = { router, isConfigured };
