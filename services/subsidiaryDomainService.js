const { getDocument, saveDocument } = require("./database");

async function getDomainMap() {
    return getDocument("subsidiaryDomains");
}

async function saveDomainMap(domainMap) {
    await saveDocument("subsidiaryDomains", domainMap);
}


function getDomainFromEmail(email) {

    const parts = String(email).toLowerCase().trim().split("@");

    return parts.length === 2 ? parts[1] : null;
}



   //RESOLVE WHICH SUBSIDIARY AN EMAIL BELONGS TO


async function resolveSubsidiary(email, chosenSubsidiary) {

    const domain = getDomainFromEmail(email);

    if (!domain) {
        return { allowed: false };
    }

    const domainMap = await getDomainMap();

    const entry = domainMap[domain];

    if (!entry) {
        return { allowed: false };
    }

    if (typeof entry === "string") {
        return { allowed: true, ambiguous: false, subsidiary: entry };
    }

    if (entry.ambiguous) {

        if (chosenSubsidiary && entry.options.includes(chosenSubsidiary)) {
            return { allowed: true, ambiguous: false, subsidiary: chosenSubsidiary };
        }

        return {
            allowed: true,
            ambiguous: true,
            question: entry.question,
            options: entry.options
        };
    }

    return { allowed: false };
}


module.exports = {
    resolveSubsidiary,
    getDomainFromEmail,
    getDomainMap,
    saveDomainMap
};