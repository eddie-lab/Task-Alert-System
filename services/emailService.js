const nodemailer = require("nodemailer");
const { getTemplate, renderTemplate, stripHtmlToText } = require("./templateService");
const { getUserById } = require("./userService");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const isConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;

if (isConfigured) {

    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // true = SSL (port 465), false = STARTTLS (port 587)
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000
    });
}


/* =========================================================
   WHY DID IT FAIL? (logged to the console, never the password)
========================================================= */

function mailErrorHint(error) {

    switch (error.code) {
        case "EAUTH":
            return "Login rejected. Check SMTP_USER / SMTP_PASS (many providers need an app password, and Microsoft 365 needs SMTP AUTH enabled for the mailbox).";
        case "ECONNECTION":
        case "ESOCKET":
        case "ECONNREFUSED":
            return "Could not connect. Check SMTP_HOST and SMTP_PORT, and that the server's firewall allows outbound mail. Use 587 (STARTTLS) or 465 (SSL).";
        case "ETIMEDOUT":
        case "ETIMEDOUT_CONNECTION":
            return "Connection timed out. The host or port is probably blocked or wrong.";
        case "ENOTFOUND":
        case "EDNS":
            return "SMTP_HOST could not be found. Check the spelling.";
        case "ETLS":
            return "TLS/SSL handshake failed. Port 465 uses SSL; 587 uses STARTTLS.";
        case "EENVELOPE":
            return "The recipient list or sender address was rejected. Check the email addresses.";
        case "EMESSAGE":
            return "The server rejected the message content.";
        default:
            return "";
    }
}

function logMailFailure(error, { to, subject }) {

    console.error("\n[EMAIL FAILED]");
    console.error(`  To:        ${Array.isArray(to) ? to.join(", ") : to}`);
    console.error(`  Subject:   ${subject}`);
    console.error(`  SMTP:      ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);
    console.error(`  Reason:    ${error.message}`);

    if (error.code) console.error(`  Code:      ${error.code}`);
    if (error.responseCode) console.error(`  Reply:     ${error.responseCode}`);
    if (error.command) console.error(`  Step:      ${error.command}`);
    if (error.response) console.error(`  Server:    ${String(error.response).trim()}`);

    const hint = mailErrorHint(error);

    if (hint) console.error(`  Hint:      ${hint}`);

    console.error("");
}

function missingSmtpSettings() {

    return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]
        .filter(name => !process.env[name]);
}

// Call once at startup: says plainly whether email can work.
async function verifyEmailConnection() {

    if (!isConfigured) {
        console.warn(`[EMAIL] Not configured. Missing: ${missingSmtpSettings().join(", ")}. Emails will ${process.env.NODE_ENV === "production" ? "FAIL" : "only be printed to this console"}.`);
        return false;
    }

    try {
        await transporter.verify();
        console.log(`[EMAIL] SMTP connection OK (${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER})`);
        return true;
    } catch (error) {
        logMailFailure(error, { to: "(connection check)", subject: "(startup verification)" });
        return false;
    }
}


/* =========================================================
   SEND MAIL VIA SMTP (USERNAME + PASSWORD)
   ---------------------------------------------------------
   If SMTP credentials aren't configured yet, log the email
   instead of failing, so the scheduler can still be tested.
========================================================= */

async function sendMail({ to, subject, body }) {

    if (!isConfigured) {

        // In production a missing SMTP setup must be an error, otherwise
        // the alert would be marked "sent" although nobody was emailed.
        if (process.env.NODE_ENV === "production") {
            throw new Error(`SMTP is not configured. Missing: ${missingSmtpSettings().join(", ")}`);
        }

        console.log(`\n[EMAIL NOT SENT - SMTP not configured]`);
        console.log(`To: ${to.join(", ")}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body: ${body}\n`);

        return;
    }

    if (!to || !to.length) {
        throw new Error("No recipients for this email");
    }

    try {

        await transporter.sendMail({
            from: `"NorrenAlerts" <${SMTP_USER}>`,
            to: to.join(", "),
            subject,
            html: body,
            text: stripHtmlToText(body)
        });

    } catch (error) {

        logMailFailure(error, { to, subject });

        throw error;
    }
}

/* =========================================================
   REMINDER / ESCALATION EMAILS
========================================================= */

async function getOwnerEmails(alert) {

    const users = await Promise.all((alert.ownerUserIds || [])
        .map(id => getUserById(id)));

    return users
        .filter(Boolean)
        .map(user => user.email);
}


async function getCreatorEmail(alert) {

    if (alert.createdByEmail) {
        return [alert.createdByEmail];
    }

    const creator = await getUserById(alert.createdByUserId);

    return creator ? [creator.email] : [];
}


function mergeRecipients(...lists) {

    const all = lists.flat().filter(Boolean);

    return [...new Set(all)];
}


async function sendReminderEmail(alert) {

    const template = await getTemplate("reminder");

    const to = mergeRecipients(
        alert.recipients || [],
        await getOwnerEmails(alert),
        await getCreatorEmail(alert)
    );

    await sendMail({
        to,
        subject: renderTemplate(template.subject, alert),
        body: renderTemplate(template.body, alert,true)
    });
}
async function sendDueDateEmail(alert) {

    const template = await getTemplate("dueDate");

    const to = mergeRecipients(
        alert.recipients || [],
        await getOwnerEmails(alert),
        await getCreatorEmail(alert)
    );

    await sendMail({
        to,
        subject: renderTemplate(template.subject, alert),
        body: renderTemplate(template.body, alert,true)
    });
}


async function sendEscalationEmail(alert) {

    const template = await getTemplate("escalation");

    const baseRecipients =
        (alert.escalationRecipients && alert.escalationRecipients.length)
            ? alert.escalationRecipients
            : (alert.recipients || []);

    const to = mergeRecipients(
        baseRecipients,
        await getOwnerEmails(alert),
        await getCreatorEmail(alert)
    );

    await sendMail({
        to,
        subject: renderTemplate(template.subject, alert),
        body: renderTemplate(template.body, alert,true)
    });
}


/* =========================================================
   COMPLETION NOTICE (sent to collaborators)
   ---------------------------------------------------------
   Uses the "completed" template if one is saved; otherwise
   falls back to this built-in default so no data change or
   migration is needed.
========================================================= */

const DEFAULT_COMPLETED_TEMPLATE = {
    subject: "Completed: {{alertName}}",
    body: '<div style="font-family:Arial,Helvetica,sans-serif; max-width:520px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;"><div style="background:#132A46; padding:20px 28px;"><span style="font-size:16px; font-weight:700; letter-spacing:0.5px; color:#ffffff;">NORREN<span style="color:#EF4136;">ALERTS</span></span></div><div style="padding:28px; font-size:15px; line-height:1.6; color:#1f2937;"><p style="margin:0 0 16px;">Hello,</p><p style="margin:0 0 16px;">The following alert has been marked as completed.</p><table role="presentation" width="100%" style="background:#ecfdf5; border-radius:6px; margin:0 0 16px; border-collapse:collapse;"><tr><td style="padding:10px 14px; font-weight:600; width:120px;">Alert</td><td style="padding:10px 14px;">{{alertName}}</td></tr><tr><td style="padding:10px 14px; font-weight:600;">Subsidiary</td><td style="padding:10px 14px;">{{subsidiary}}</td></tr><tr><td style="padding:10px 14px; font-weight:600;">Completed by</td><td style="padding:10px 14px; color:#047857; font-weight:600;">{{completedBy}}</td></tr><tr><td style="padding:10px 14px; font-weight:600;">Completed on</td><td style="padding:10px 14px; color:#047857; font-weight:600;">{{completedDate}}</td></tr><tr><td style="padding:10px 14px; font-weight:600;">Due date</td><td style="padding:10px 14px;">{{dueDate}}</td></tr><tr><td style="padding:10px 14px; font-weight:600; vertical-align:top;">Description</td><td style="padding:10px 14px;">{{description}}</td></tr></table><p style="margin:0 0 24px;">No further action is needed for this occurrence.</p><a href="{{loginUrl}}" style="display:inline-block; background:#EF4136; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 24px; border-radius:6px;">Open NorrenAlerts &rarr;</a></div><div style="background:#f9fafb; padding:16px 28px; border-top:1px solid #e5e7eb;"><p style="margin:0; font-size:12px; color:#9ca3af;">NorrenAlerts &middot; Powered by Norrenberger Robotics Process Automation Unit</p></div></div>'
};

async function sendCompletedEmail(alert, { excludeEmails = [] } = {}) {

    const skip = new Set(
        excludeEmails.filter(Boolean).map(email => email.toLowerCase())
    );

    const to = mergeRecipients(await getOwnerEmails(alert))
        .filter(email => !skip.has(String(email).toLowerCase()));

    if (!to.length) {
        return;
    }

    let template;

    try {
        template = await getTemplate("completed");
    } catch (error) {
        template = DEFAULT_COMPLETED_TEMPLATE;
    }

    await sendMail({
        to,
        subject: renderTemplate(template.subject, alert),
        body: renderTemplate(template.body, alert, true)
    });
}


module.exports = {
    sendReminderEmail,
    sendDueDateEmail,
    sendEscalationEmail,
    sendCompletedEmail,
    verifyEmailConnection
};