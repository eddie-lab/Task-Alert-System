const params = new URLSearchParams(window.location.search);

const errorBox = document.getElementById("authError");
const signInButton = document.getElementById("microsoftSignInButton");
const signupStep = document.getElementById("signupStep");
const signupMessage = document.getElementById("signupMessage");
const signinTitle = document.getElementById("signinTitle");
const signinDescription = document.getElementById("signinDescription");
const subsidiaryFields = document.getElementById("subsidiaryFields");
const subsidiaryLabel = document.getElementById("subsidiaryQuestionLabel");
const subsidiarySelect = document.getElementById("subsidiaryChoice");
const completeButton = document.getElementById("completeSignupButton");

if (params.get("error")) {
    errorBox.textContent = params.get("error");
    errorBox.classList.remove("hidden");
}

const needsSignup = params.get("needsSignup") === "1";
const needsSubsidiary = params.get("needsSubsidiary") === "1";

if (needsSignup || needsSubsidiary) {
    signInButton.style.display = "none";
    signupStep.classList.remove("hidden");
    signinTitle.textContent = "Complete your signup";
    completeButton.textContent = "Complete signup";

    if (needsSubsidiary) {
        signinDescription.textContent = "Choose your subsidiary to finish creating your account.";
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
    } else {
        signinDescription.textContent = "Your Microsoft account is verified. Complete signup to create your account.";
        signupMessage.textContent = "Continue to finish creating your account.";
        signupMessage.classList.remove("hidden");
        subsidiaryFields.classList.add("hidden");
    }
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