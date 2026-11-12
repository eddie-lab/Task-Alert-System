const { getDocument, saveDocument } = require("./database");

//Load templates from the JSON file


async function getTemplates() {
    return getDocument("templates");
}


async function getTemplate(type) {

    const templates = await getTemplates();

    const template = templates[type];

    if (!template) {

        throw new Error(`No email template found for type "${type}"`);
    }

    return template;
}

async function saveTemplates(templates) {
    await saveDocument("templates", templates);
}


function formatDueDate(dueDate) {

    return new Date(dueDate).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}


/* =========================================================
   RENDER A TEMPLATE AGAINST AN ALERT
========================================================= */

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderTemplate(templateString, alert, asHtml = false) {

    const clean = value => asHtml ? escapeHtml(value) : value;

    const values = {
        alertName: clean(alert.name),
        description: asHtml
            ? escapeHtml(alert.description || "").replace(/\r?\n/g, "<br>")
            : (alert.description || ""),
        dueDate: formatDueDate(alert.dueDate),
        subsidiary: clean(alert.subsidiary),
        owner: clean(alert.owner || "Not set"),
        loginUrl: `${APP_URL}/signup.html`
    };

    return templateString.replace(/{{\s*(\w+)\s*}}/g, (match, key) => {

        return Object.prototype.hasOwnProperty.call(values, key)
            ? values[key]
            : match;
    });
}


/* =========================================================
   PLAIN-TEXT FALLBACK FOR THE HTML TEMPLATE
   ---------------------------------------------------------
   Templates are HTML now, but some mail clients (and all
   screen readers) prefer a plain-text part. Rather than
   maintain two separate templates, this derives one
   automatically from the rendered HTML.
========================================================= */

function stripHtmlToText(html) {

    return html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/td>/gi, "  ")
        .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n\n")
        .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
        .replace(/<[^>]+>/g, "")
        .replace(/&rarr;/g, "->")
        .replace(/&middot;/g, "-")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


module.exports = {
    getTemplate,
    getTemplates,
    saveTemplates,
    renderTemplate,
    stripHtmlToText
};
