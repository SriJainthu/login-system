const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://login-system-1-vcj6.onrender.com';
const validators = {
    name: value => /^[A-Za-z\s]+$/.test(value),
    college: value => /^[A-Za-z\s]+$/.test(value),
    department: value => /^[A-Za-z\s]+$/.test(value),
    // Updated: Now strictly requires exactly 12 digits
    reg_no: value => /^[0-9]{12}$/.test(value),
    year: value => /^[1-4]$/.test(value),
    phone: value => /^[0-9]{10}$/.test(value),
    email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
};

function getErrorMessage(fieldId) {
    switch(fieldId) {
        case "name": return "Name cannot contain numbers";
        case "college": return "College cannot contain numbers";
        case "department": return "Department cannot contain numbers";
        // Updated: Clearly informs the student of the 12-digit requirement
        case "reg_no": return "Register number must be exactly 12 digits";
        case "year": return "Enter year between (1-4)"; 
        case "phone": return "Phone must be 10 digits";
        case "email": return "Invalid email format";
        default: return "Invalid input";
    }
}

function validateField(fieldId) {
    const input = document.getElementById(fieldId);
    const container = input.closest('.input-field');
    const errorDisplay = document.getElementById(fieldId + "Error");

    if (!input || !errorDisplay) return true;

    // Run the specific validator for this field
    const isValid = validators[fieldId] ? validators[fieldId](input.value.trim()) : true;

    if (isValid) {
        container.classList.remove("has-error");
        // We don't clear text immediately to keep the exit animation smooth
        setTimeout(() => { if(!container.classList.contains('has-error')) errorDisplay.textContent = ""; }, 300);
        return true;
    } else {
        container.classList.add("has-error");
        // Get the specific message (e.g., "Please enter a valid email")
        errorDisplay.textContent = getErrorMessage ? getErrorMessage(fieldId) : "Invalid input";
        return false;
    }
}

/* ---------- REGISTRATION STEP 1: DUPLICATION CHECK & OTP ---------- */
/* Update only this function in your script.js */
async function initiateRegistrationOTP() {
    const mainError = document.getElementById("mainError");
    const btn = document.getElementById("nextStepBtn");
    const btnText = document.getElementById("btnText");
    const loader = document.getElementById("btnLoader");

    // Get values
    const fields = {
        name: document.getElementById("name").value.trim(),
        reg_no: document.getElementById("reg_no").value.trim(),
        college: document.getElementById("college").value.trim(),
        department: document.getElementById("department").value.trim(),
        year: document.getElementById("year").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim()
    };

    const fieldsToValidate = ["name", "reg_no", "college", "department", "year", "email", "phone"];
    const isFormValid = fieldsToValidate.every(field => validateField(field));
    
    if (!isFormValid) return; 

    // UI Loading State
    btn.disabled = true;
    if(loader) loader.style.display = "inline-block";
    if(btnText) btnText.innerText = "Verifying..."; 

   try {
        const response = await fetch(`${API_BASE_URL}/register/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fields.email, reg_no: fields.reg_no }) 
        });

        // ALWAYS parse the data first, even for errors
        const data = await response.json();

        if (response.status === 409) {
            // This is where "Already Registered" is handled
            // Use the message from the server, or a fallback
            showCustomAlert(data.message || "This Email or Register Number is already registered.");
            resetBtn(btn, btnText, loader); 
        } else if (response.ok && data.success) {
            // Success logic...
            localStorage.setItem("studentData", JSON.stringify(fields));
            const otpOverlay = document.getElementById('otpOverlay');
            otpOverlay.style.display = 'flex';
            setTimeout(() => { otpOverlay.style.opacity = "1"; }, 10);
        } else {
            // Other server errors (500, etc.)
            const errorDisplay = document.getElementById("mainError");
            errorDisplay.textContent = data.message || "Server error. Please try again.";
            resetBtn(btn, btnText, loader);
        }
    } catch (error) {
        console.error("Fetch error:", error);
        document.getElementById("mainError").textContent = "Connection error. Is the server running?";
        resetBtn(btn, btnText, loader);
    }
}
function resetBtn() {
    const btn = document.getElementById("nextStepBtn");
    const btnText = document.getElementById("btnText");
    const loader = document.getElementById("btnLoader");

    if (btn) {
        btn.disabled = false;
        btn.style.background = ""; // Restores original gradient
        btn.style.opacity = "1";
    }
    
    if (loader) loader.style.display = "none";
    
    if (btnText) {
        btnText.innerText = "Next Step →";
    } else if (btn) {
        btn.innerText = "Next Step →";
    }
}
/* ---------- REGISTRATION STEP 2: VERIFY OTP ---------- */
function verifyAndProceed() {
    const email = document.getElementById("email").value.trim();
    const otp = document.getElementById("registrationOtp").value.trim();
    const otpError = document.getElementById("otpError");
    const verifyBtn = document.getElementById("verifyBtn");

    if (otp.length !== 6) {
        otpError.textContent = "Enter a valid 6-digit code.";
        return;
    }

    verifyBtn.disabled = true;
    verifyBtn.innerText = "Processing...";

    // Change this line:
fetch(`${API_BASE_URL}/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            window.location.href = "select-events.html";
        } else {
            otpError.textContent = data.message || "Invalid OTP.";
            verifyBtn.disabled = false;
            verifyBtn.innerText = "Verify & Continue";
        }
    })
    .catch(() => {
        otpError.textContent = "Verification failed.";
        verifyBtn.disabled = false;
        verifyBtn.innerText = "Verify & Continue";
    });
}

/* ---------- UI HELPERS ---------- */
function showCustomAlert(msg) {
    const alertOverlay = document.getElementById('customAlert');
    const alertMessage = document.getElementById('alertMessage');
    const alertBox = document.getElementById('alertBox');

    if (alertMessage) {
        alertMessage.textContent = msg; 
    }

    // FIX: Add 'flex-show' to the overlay so it stops being display:none
    alertOverlay.classList.add('flex-show');
    
    setTimeout(() => {
        if (alertBox) alertBox.classList.add('active');
    }, 10);
}
function closeAlert() {
    const alertOverlay = document.getElementById('customAlert');
    const alertBox = document.getElementById('alertBox');
    
    if(alertBox) alertBox.classList.remove('active');
    
    setTimeout(() => { 
        // FIX: Remove 'flex-show' to hide the overlay again
        alertOverlay.classList.remove('flex-show'); 
    }, 300);
}
function closeOtpOverlay() {
    const otpOverlay = document.getElementById('otpOverlay');
    
    // 1. Hide the overlay
    otpOverlay.style.opacity = "0";
    setTimeout(() => { 
        otpOverlay.style.display = 'none'; 
    }, 300);

    // 2. Clear error messages
    const otpError = document.getElementById("otpError");
    if(otpError) otpError.textContent = ""; 
    
    // 3. Clear the OTP input
    const otpInput = document.getElementById("registrationOtp");
    if(otpInput) otpInput.value = "";

    // 4. CRITICAL FIX: Reset the main button
    resetBtn(); 
}
function toggleMenu() {
    const menu = document.getElementById("sideMenu");
    const toggle = document.querySelector(".menu-toggle");
    
    if (menu.classList.contains("open")) {
        menu.classList.remove("open");
        toggle.classList.remove("open");
    } else {
        menu.classList.add("open");
        toggle.classList.add("open");
    }
}

/* ---------- AUTO-TOKEN GENERATOR HELPER ---------- */
function generateUniqueToken(eventName) {
    const prefix = eventName.substring(0, 3).toUpperCase().replace(/\s/g, 'X');
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const datePart = Date.now().toString().slice(-3);
    return `${prefix}-${randomPart}${datePart}`;
}

/* ---------- UPDATED DYNAMIC EVENT LOADING ---------- */
document.addEventListener("DOMContentLoaded", async () => {
    const eventsDiv = document.getElementById("events") || document.getElementById("eventsList");
    if (!eventsDiv) return;

    try {
        // 1. Fetch both Events AND Settings (to get the limit)
        const [eventRes, settingsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/events`),
    fetch(`${API_BASE_URL}/api/settings`)
        ]);
        
        const events = await eventRes.json();
        const { settings } = await settingsRes.json();
        const selectionLimit = settings.event_selection_limit || 3;

        // 2. Render Events
        eventsDiv.innerHTML = events.map(e => `
            <div class="event-card" id="card-${e.id}" style="margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; background: rgba(255,255,255,0.02); transition: 0.3s;">
                <label style="font-weight: bold; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" class="event-checkbox" value="${e.id}" data-name="${e.event_name}" style="margin-right: 12px; transform: scale(1.2);"> 
                    <span class="event-name">${e.event_name}</span>
                </label>
                
                <div class="token-section" style="margin-left: 28px; margin-top: 10px; display: none;">
                    <label style="font-size: 11px; color: var(--primary-blue); display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px;">Join Team</label>
                    <input type="text" 
                           class="team-token-input" 
                           placeholder="Enter existing token or leave blank" 
                           style="width: 90%; padding: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,198,255,0.3); border-radius: 8px; color: #fff; outline: none;">
                </div>
            </div>
        `).join("");

        // 3. Event Listener for Limit and UI Toggles
        eventsDiv.addEventListener("change", (e) => {
            if (e.target.classList.contains("event-checkbox")) {
                const card = e.target.closest('.event-card');
                const tokenSection = card.querySelector('.token-section');
                const checkedBoxes = eventsDiv.querySelectorAll(".event-checkbox:checked");

                // Enforce Limit
                if (checkedBoxes.length > selectionLimit) {
                    e.target.checked = false;
                    tokenSection.style.display = "none";
                    showCustomAlert(`Maximum reached: You can only select ${selectionLimit} events.`);
                    return;
                }

                // Toggle visibility of token input and card highlight
                if (e.target.checked) {
                    tokenSection.style.display = "block";
                    card.style.borderColor = "var(--primary-blue)";
                    card.style.background = "rgba(0, 198, 255, 0.05)";
                } else {
                    tokenSection.style.display = "none";
                    card.style.borderColor = "rgba(255,255,255,0.1)";
                    card.style.background = "rgba(255,255,255,0.02)";
                }
            }
        });

    } catch (err) {
        console.error("Error loading events:", err);
    }
});

/* ---------- UPDATED FINAL SUBMISSION ---------- */
function submitRegistration() {
    const registerBtn = document.getElementById("registerBtn");
    const student = JSON.parse(localStorage.getItem("studentData"));
    
    if (!student) {
        window.location.href = "student-details.html";
        return;
    }

    const container = document.getElementById("events") || document.getElementById("eventsList");
    const checkedBoxes = [...container.querySelectorAll(".event-checkbox:checked")];

    const eventData = checkedBoxes.map(box => {
        const card = box.closest('.event-card');
        const name = card.querySelector('.event-name').textContent.trim();
        const tokenInput = card.querySelector('.team-token-input');
        
        let finalToken = null;
        if (tokenInput) {
            const userVal = tokenInput.value.trim();
            // LOGIC: If input is empty, system generates a unique team ID (Leader)
            // If input is filled, use that ID (Member joining team)
            finalToken = (userVal === "") ? generateUniqueToken(name) : userVal;
        }

        return {
            name: name,
            token: finalToken
        };
    });

    if (eventData.length === 0) {
        alert("Please select at least one event.");
        return;
    }

    registerBtn.disabled = true;
    registerBtn.innerText = "Finishing...";

    fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...student, events: eventData })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            localStorage.removeItem("studentData");
            window.location.href = "registration-success.html";
        } else {
            alert(data.message || "Registration failed");
            registerBtn.disabled = false;
            registerBtn.innerText = "Submit";
        }
    })
    .catch(err => {
        console.error(err);
        alert("Connection Error. Please check your network.");
        registerBtn.disabled = false;
        registerBtn.innerText = "Submit";
    });
}