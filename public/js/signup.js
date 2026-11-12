const params = new URLSearchParams(window.location.search);

const errorBox = document.getElementById("authError");
const signInButton = document.getElementById("microsoftSignInButton");
const subsidiaryStep = document.getElementById("subsidiaryStep");
const subsidiaryLabel = document.getElementById("subsidiaryQuestionLabel");
const subsidiarySelect = document.getElementById("subsidiaryChoice");
const completeButton = document.getElementById("completeSignupButton");

if (params.get("error")) {
    errorBox.textContent = params.get("error");
    errorBox.classList.remove("hidden");
}

if (params.get("needsSubsidiary")) {

    signInButton.style.display = "none";
    subsidiaryStep.classList.remove("hidden");

    subsidiaryLabel.textContent =
        params.get("question") || "Which subsidiary are you part of?";

    let options = [];

    try {
        const parsed = JSON.parse(params.get("options") || "[]");
        options = Array.isArray(parsed) ? parsed.filter(o => typeof o === "string") : [];
    } catch (error) {
        options = [];
    }

    subsidiarySelect.replaceChildren(
        ...options.map(option => new Option(option, option))
    );
}

completeButton?.addEventListener("click", async () => {

    const response = await fetch("/api/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subsidiary: subsidiarySelect.value })
    });

    const data = await response.json();

    if (!response.ok) {
        errorBox.textContent = data.message || "Unable to complete signup.";
        errorBox.classList.remove("hidden");
        return;
    }

    window.location.href = "/";
});