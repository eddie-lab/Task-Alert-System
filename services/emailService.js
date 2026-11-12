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
        }
    });
}


/* =========================================================
   SEND MAIL VIA SMTP (USERNAME + PASSWORD)
   ---------------------------------------------------------
   If SMTP credentials aren't configured yet, log the email
   instead of failing, so the scheduler can still be tested.
========================================================= */

async function sendMail({ to, subject, body }) {

    if (!isConfigured) {

        console.log(`\n[EMAIL NOT SENT - SMTP not configured]`);
        console.log(`To: ${to.join(", ")}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body: ${body}\n`);

        return;
    }

    await transporter.sendMail({
        from: `"NorrenAlerts" <${SMTP_USER}>`,
        to: to.join(", "),
        subject,
        html: body,
        text: stripHtmlToText(body)
    });
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


module.exports = {
    sendReminderEmail,
    sendDueDateEmail,
    sendEscalationEmail
};