const express = require("express");
const db = require('./db');
//const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require('axios'); // Added Nodemailer
require('dotenv').config();
// Set slightly below 500 for safety
const app = express();
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
/*const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');*/
const cron = require('node-cron');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/* ---------- EMAIL CONFIGURATION (NODEMAILER) ---------- */
const BREVO_ACCOUNTS = [
    { apiKey: process.env.BREVO_API_KEY_1, email: process.env.BREVO_EMAIL_1, limit: 300 },
    { apiKey: process.env.BREVO_API_KEY_2, email: process.env.BREVO_EMAIL_2, limit: 300 },
    { apiKey: process.env.BREVO_API_KEY_3, email: process.env.BREVO_EMAIL_3, limit: 300 }, // ✅ NEW
];
console.log("✅ Brevo Email Service Ready");



/* ---------- MIDDLEWARE ---------- */
app.use(cors({
    origin: [
        "https://login-system-1-nowr.onrender.com",
        "http://localhost:5500"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(bodyParser.json());
function verifyAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(403).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }
}
// Add these BEFORE your routes
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

/* ---------- DATABASE (POOL) ---------- */
/*const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
*/
const promiseDb = db.promise();
/*cron.schedule('0 0 * * *', () => {
    console.log("🕛 Midnight IST: Resetting Daily Email Counter.");
    emailCounter = 0;
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});*/

async function sendSymposiumEmail(mailOptions) {
    // Get today's date in IST
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Get or create today's count from DB
    await promiseDb.query(
        `INSERT INTO email_usage (usage_date, count) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE count = count + 1`,
        [today]
    );

    // Read the current count
    const [[usage]] = await promiseDb.query(
        "SELECT count FROM email_usage WHERE usage_date = ?",
        [today]
    );

    const emailCounter = usage.count;

    // Decide which account to use
    let accountIndex = -1;
    let cumulative = 0;
    for (let i = 0; i < BREVO_ACCOUNTS.length; i++) {
        cumulative += BREVO_ACCOUNTS[i].limit;
        if (emailCounter <= cumulative) { accountIndex = i; break; }
    }

    if (accountIndex === -1) {
        console.error("🚨 Daily email limit exhausted!");
        throw new Error("Daily registration limit reached. Please contact admin.");
    }

    const account = BREVO_ACCOUNTS[accountIndex];
    console.log(`[Email] Account ${accountIndex + 1}: ${account.email} | Today's Total: ${emailCounter}`);

    const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
            sender: { name: "Symposium 2026", email: account.email },
            to: [{ email: mailOptions.to }],
            subject: mailOptions.subject,
            htmlContent: mailOptions.html,
        },
        {
            headers: {
                'api-key': account.apiKey,
                'Content-Type': 'application/json',
            }
        }
    );
    return response.data;
}
app.post("/register/send-otp", async (req, res) => {
    const { email, reg_no } = req.body; 

    if (!email || !reg_no) {
        return res.status(400).json({ success: false, message: "Missing Email or Register Number" });
    }

    try {
        // 1. Check if student already exists
        const [existingReg] = await promiseDb.query("SELECT reg_no FROM students WHERE reg_no = ?", [reg_no]);
        if (existingReg.length > 0) {
            return res.status(409).json({ success: false, message: `Register Number ${reg_no} is already registered!` });
        }

        const [existingEmail] = await promiseDb.query("SELECT email FROM students WHERE email = ?", [email]);
        if (existingEmail.length > 0) {
            return res.status(409).json({ success: false, message: "This Email is already registered!" });
        }

        // 2. Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // 3. Store OTP
        await promiseDb.query(
            `REPLACE INTO otp_verification (identifier, otp, expires_at, purpose) 
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'register')`, 
            [email, otp]
        );

        // 4. Send via Email Switcher
       await sendSymposiumEmail({
    to: email,
    subject: `🔐 Registration OTP: ${otp}`,
    html: `
    <div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
        <div style="max-width: 500px; margin: 0 auto; background: #16262e; border: 1px solid rgba(0, 198, 255, 0.2); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
            
            <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">SYMPOSIUM <span style="color: #0b1419; opacity: 0.7;">2026</span></h1>
                <div style="height: 2px; width: 40px; background: #ffffff; margin: 10px auto; border-radius: 2px;"></div>
                <p style="color: #ffffff; margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Registration Verification</p>
            </div>

            <div style="padding: 40px 35px; text-align: center;">
                <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; font-weight: 600;">Complete Your Registration</h2>
                <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">
                    You're almost there! Use the secure code below to verify your email and complete your enrollment for Symposium 2026:
                </p>

                <div style="background: rgba(0, 198, 255, 0.05); border: 1px dashed #00c6ff; border-radius: 18px; padding: 30px; margin: 30px 0;">
                    <span style="display: block; color: #00ffae; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 15px; font-weight: 800;">
                        Double-Click to Copy
                    </span>
                    <div style="font-size: 48px; font-weight: 800; letter-spacing: 10px; color: #ffffff; text-shadow: 0 0 20px rgba(0, 198, 255, 0.6); font-family: 'Courier New', monospace; cursor: pointer; display: inline-block; user-select: all; -webkit-user-select: all; -moz-user-select: all; -ms-user-select: all;">
                        ${otp}
                    </div>
                </div>

                <p style="color: #556a75; font-size: 12px; line-height: 1.6;">
                    This code is valid for <strong>10 minutes</strong>.<br>
                    If you did not request this code, please ignore this email.
                </p>
            </div>

            <div style="background: rgba(0, 0, 0, 0.2); padding: 25px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                <p style="color: #44555e; font-size: 10px; margin: 0; line-height: 1.5; text-transform: uppercase; letter-spacing: 1px;">
                    © 2026 SYMPOSIUM ORGANIZING COMMITTEE <br>
                    SECURED BY INNOVATION CELL
                </p>
            </div>
        </div>
    </div>`
});

        console.log(`✅ Email OTP sent to: ${email}`);
        res.json({ success: true, message: "Verification code sent to your email!" });

    } catch (err) {
        console.error("❌ Email OTP Error:", err);
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
});
app.post("/register", async (req, res) => {
    const { name, reg_no, college, department, year, level, degree, email, phone, events } = req.body;

    // ✅ FIX 1: Validate events exists and is a non-empty array
    if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ success: false, message: "No events selected." });
    }

    // ✅ FIX 2: Safely extract event names (handle both .name and .event_name)
    const eventNames = events.map(e => e.name || e.event_name).filter(Boolean);

    if (eventNames.length === 0) {
        return res.status(400).json({ success: false, message: "Invalid event data received." });
    }

    try {
        const [eventRows] = await promiseDb.query(
            "SELECT id, event_name FROM events WHERE event_name IN (?)",
            [eventNames]
        );

        // ✅ FIX 3: Check that we actually found events in DB
        if (eventRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected events not found in database." });
        }

        const connection = await db.promise().getConnection();

        try {
            await connection.beginTransaction();
            console.log("Register payload:", req.body);

            const [studentResult] = await connection.query(
                "INSERT INTO students (name, reg_no, college, department, year, email, phone, degree, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [name, reg_no, college, department, year, email, phone, degree, level]
            );
            const studentId = studentResult.insertId;

            // ✅ FIX 4: Build mappingValues safely, skip events not found in DB
            const mappingValues = [];
            for (const row of eventRows) {
                const originalEvent = events.find(e =>
                    (e.name || e.event_name || '').toLowerCase() === row.event_name.toLowerCase()
                );

                if (!originalEvent) continue; // skip if no match

                const token = (originalEvent.token && originalEvent.token.trim() !== "")
                    ? originalEvent.token.trim()
                    : null;

                mappingValues.push([studentId, row.id, token]);
            }

            // ✅ FIX 5: Guard against empty mappingValues before bulk insert
            if (mappingValues.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ success: false, message: "Could not map any events. Please try again." });
            }

            await connection.query(
                "INSERT INTO student_events (student_id, event_id, team_token) VALUES ?",
                [mappingValues]
            );

            await connection.commit();

            res.json({ success: true, redirect: "/registration-success.html" });
            console.log(`🚀 Registration instant-success for ${name}.`);

            // Background email (unchanged)
            setTimeout(async () => {
                try {
                    const [details] = await promiseDb.query(
                        `SELECT e.event_name, se.team_token FROM student_events se JOIN events e ON se.event_id = e.id WHERE se.student_id = ?`,
                        [studentId]
                    );

                    const eventListHtml = details.map(d =>
                        `<li style="color: #ffffff; margin-bottom: 8px;">✅ <strong>${d.event_name}</strong> <span style="color: #8899a0; font-size: 13px;">(${d.team_token || 'Solo'})</span></li>`
                    ).join('');

                    await sendSymposiumEmail({
                        to: email,
                        subject: `🎉 Registration Confirmed: ${name}`,
                        html: `
                        <div style="background-color: #0f2027; padding: 50px 20px; font-family: 'Segoe UI', Arial, sans-serif;">
                            <div style="max-width: 550px; margin: 0 auto; background: #16262e; border-radius: 28px; overflow: hidden; border: 1px solid rgba(0, 198, 255, 0.2);">
                                <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 3px;">SYMPOSIUM 2026</h1>
                                    <p style="color: #ffffff; margin: 0; font-size: 12px; text-transform: uppercase;">Official Confirmation Receipt</p>
                                </div>
                                <div style="padding: 40px 35px;">
                                    <h2 style="color: #ffffff; font-size: 20px;">Congratulations, ${name}!</h2>
                                    <p style="color: #8899a0; font-size: 15px;">Your registration has been successfully processed. Below are your event details:</p>
                                    <div style="background: rgba(255, 255, 255, 0.03); border-radius: 15px; padding: 20px; margin: 20px 0;">
                                        <p style="color: #00c6ff; margin: 0 0 10px 0; font-size: 12px; text-transform: uppercase; font-weight: bold;">Registered Events:</p>
                                        <ul style="list-style: none; padding: 0; margin: 0;">${eventListHtml}</ul>
                                    </div>
                                </div>
                                <div style="background: rgba(0, 0, 0, 0.2); padding: 20px; text-align: center; color: #44555e; font-size: 10px;">
                                    © 2026 SYMPOSIUM ORGANIZING COMMITTEE
                                </div>
                            </div>
                        </div>`
                    });

                    console.log(`✅ Confirmation Email sent to ${name}`);
                } catch (mailErr) {
                    console.error("❌ Background Confirmation Email Error:", mailErr.message);
                }
            }, 2000);

        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error("❌ Final Register Error:", err);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "Database Error during registration" });
        }
    }
});
app.post("/send-otp", async (req, res) => {
    const { reg_no } = req.body;
    
    try {
        const [students] = await promiseDb.query(
            "SELECT id, email, name, otp_count, last_otp_date FROM students WHERE reg_no = ?", 
            [reg_no]
        );
        
        if (students.length === 0) {
            return res.status(404).json({ message: "Register number not found" });
        }

        const student = students[0];

        // --- UPDATED DATE LOGIC FOR IST ---
        // 'en-CA' gives YYYY-MM-DD which matches MySQL DATE format perfectly
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); 
        
        // Convert the DB date to the same YYYY-MM-DD format for a fair comparison
        const dbDateString = student.last_otp_date ? 
            new Date(student.last_otp_date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
        
        let currentCount = (dbDateString === today) ? (student.otp_count || 0) : 0;
        // ----------------------------------

        if (currentCount >= 3) {
            return res.status(429).json({ 
                success: false, 
                message: "Daily limit reached. You can only request 3 OTPs per day." 
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Save the updated count and today's IST date back to the DB
        await promiseDb.query(
            "UPDATE students SET otp_count = ?, last_otp_date = ? WHERE reg_no = ?",
            [currentCount + 1, today, reg_no]
        );

        // 2. Store the OTP for verification
        await promiseDb.query(
            `REPLACE INTO otp_verification (identifier, otp, expires_at, purpose) 
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'view')`, 
            [reg_no, otp]
        );
        
        // 3. Send the Email using the Alternating Logic
        await sendSymposiumEmail({
            to: student.email,
            subject: `🔐 Access Code: ${otp}`,
           html: `
<div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
    <div style="max-width: 500px; margin: 0 auto; background: #16262e; border: 1px solid rgba(0, 198, 255, 0.2); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
        
        <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">SYMPOSIUM <span style="color: #0b1419; opacity: 0.7;">2026</span></h1>
            <div style="height: 2px; width: 40px; background: #ffffff; margin: 10px auto; border-radius: 2px;"></div>
            <p style="color: #ffffff; margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Security Verification</p>
        </div>

        <div style="padding: 40px 35px; text-align: center;">
            <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; font-weight: 600;">Verify Your Identity</h2>
            <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">
                To access your live registration status and digital pass, please use the secure verification code below:
            </p>

            <div style="background: rgba(0, 198, 255, 0.05); border: 1px dashed #00c6ff; border-radius: 18px; padding: 30px; margin: 30px 0;">
                <span style="display: block; color: #00ffae; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 15px; font-weight: 800;">
                    Double-Click to Copy
                </span>
                <div style="font-size: 48px; font-weight: 800; letter-spacing: 10px; color: #ffffff; text-shadow: 0 0 20px rgba(0, 198, 255, 0.6); font-family: 'Courier New', monospace; display: inline-block; padding: 10px; border-radius: 8px; cursor: pointer; user-select: all; -webkit-user-select: all;">
                    ${otp}
                </div>
            </div>

            <p style="color: #556a75; font-size: 12px; line-height: 1.6;">
                This code is valid for <strong>10 minutes</strong>.<br>
                If you did not request this code, please ignore this email.
            </p>
        </div>

        <div style="background: rgba(0, 0, 0, 0.2); padding: 25px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05);">
            <p style="color: #44555e; font-size: 10px; margin: 0; line-height: 1.5; text-transform: uppercase; letter-spacing: 1px;">
                © 2026 SYMPOSIUM ORGANIZING COMMITTEE <br>
                SECURED BY INNOVATION CELL
            </p>
        </div>
    </div>
</div>`
        });

       res.json({ success: true, message: "OTP Sent" });

    } catch (err) { 
        console.error("❌ View-OTP Error:", err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    }
});
/* ---------- PRESERVED ROUTES (EVENTS, ADMIN, ETC) ---------- */
app.get("/events", (req, res) => {
    db.query("SELECT * FROM events", (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch events" });
        res.json(rows);
    });
});

app.post("/register/verify-otp", async (req, res) => {
    const { email, otp } = req.body;
    const [rows] = await promiseDb.query("SELECT * FROM otp_verification WHERE identifier=? AND otp=? AND purpose='register' AND expires_at > NOW()", [email, otp]);
    if (rows.length > 0) {
        await promiseDb.query("DELETE FROM otp_verification WHERE identifier=? AND purpose='register'", [email]);
        res.json({ success: true, message: "Email verified!" });
    } else res.status(400).json({ message: "Invalid or expired OTP" });
});

app.post("/verify-otp", async (req, res) => {
    const { reg_no, otp } = req.body;
    const [rows] = await promiseDb.query("SELECT * FROM otp_verification WHERE identifier=? AND otp=? AND purpose='view' AND expires_at > NOW()", [reg_no, otp]);
    if (rows.length > 0) {
        await promiseDb.query("DELETE FROM otp_verification WHERE identifier=? AND purpose='view'", [reg_no]);
        res.json({ success: true });
    } else res.status(400).json({ message: "Invalid or expired OTP" });
});

app.get("/registration/:reg_no", async (req, res) => {
    const reg_no = req.params.reg_no.trim();
    try {
        const [students] = await promiseDb.query("SELECT * FROM students WHERE reg_no = ?", [reg_no]);
        if (students.length === 0) return res.status(404).json({ message: "Not found" });
        const student = students[0];
        const [events] = await promiseDb.query(`
            SELECT e.event_name, se.team_token,
            (SELECT GROUP_CONCAT(s2.name SEPARATOR ', ') FROM student_events se2 JOIN students s2 ON se2.student_id = s2.id WHERE se2.team_token = se.team_token AND se2.event_id = se.event_id) AS team_members
            FROM student_events se JOIN events e ON se.event_id = e.id WHERE se.student_id = ?`, [student.id]);
        res.json({ student, events });
    } catch (err) { res.status(500).json({ message: "Error fetching data" }); }
});

app.get("/validate-token", (req, res) => {
    const { eventId, token } = req.query;
    db.query("SELECT max_team_size FROM events WHERE id = ?", [eventId], (err, eventResults) => {
        if (err || eventResults.length === 0) return res.status(404).json({ error: "Event not found" });
        const maxLimit = eventResults[0].max_team_size;
        db.query("SELECT COUNT(*) as currentCount FROM student_events WHERE team_token = ? AND event_id = ?", [token.trim(), eventId], (err, countResult) => {
            const currentMembers = countResult[0].currentCount;
            if (currentMembers === 0) res.json({ status: "invalid", message: "Code does not exist." });
            else if (currentMembers < maxLimit) res.json({ status: "join", message: `Team found! (${currentMembers}/${maxLimit})` });
            else res.json({ status: "full", message: "Team full" });
        });
    });
});

app.post("/admin/login", (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {

        const token = jwt.sign(
            { user: username },
            JWT_SECRET,
            { expiresIn: "30m" }
        );

        res.json({ success: true, token });

    } else {
        res.status(401).json({ success: false });
    }
});

app.get("/admin/students", verifyAdmin, (req, res) => {
    const { year, department, college, event, reg_no } = req.query;
    
    let sql = `
        SELECT 
            s.name, 
            s.reg_no, 
            s.college, 
            s.department, 
            s.year, 
            s.phone,
            COALESCE(GROUP_CONCAT(DISTINCT e.event_name SEPARATOR ', '), 'None') AS events
        FROM students s
        LEFT JOIN student_events se ON s.id = se.student_id
        LEFT JOIN events e ON se.event_id = e.id
        WHERE 1=1 `;

    const params = [];
    if (reg_no) { sql += " AND s.reg_no = ?"; params.push(reg_no); }
    if (year) { sql += " AND s.year = ?"; params.push(year); }
    if (department) { sql += " AND s.department = ?"; params.push(department); }
    if (college) { sql += " AND s.college = ?"; params.push(college); }
    if (event) { sql += " AND e.event_name = ?"; params.push(event); }

    sql += " GROUP BY s.id ORDER BY s.id DESC";

    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "Load failed" });
        res.json(rows); // Now 'rows' contains keys like 'name' and 'events'
    });
});

app.get("/admin/download", verifyAdmin,(req, res) => {
    db.query("SELECT s.name, s.reg_no, s.college, s.department, s.year FROM students s", (err, rows) => {
        if (err) return res.status(500).json({ error: "Download failed" });
        let csv = "Name,Register No,College,Department,Year\n";
        rows.forEach(r => { csv += `"${r.name}","${r.reg_no}","${r.college}","${r.department}","${r.year}"\n`; });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=Report.csv");
        res.send(csv);
    });
});

app.get("/api/settings", verifyAdmin, async (req, res) => {
    try {
        const [rows] = await promiseDb.query(
            "SELECT * FROM symposium_settings WHERE id = 1"
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Could not load settings" });
    }
});

app.post("/api/settings", verifyAdmin, async (req, res) => {
    try {
        const { limit, deadline, header_text, symposium_title } = req.body;
        if (limit) await promiseDb.query("UPDATE symposium_settings SET event_selection_limit = ? WHERE id = 1", [parseInt(limit)]);
        if (deadline) await promiseDb.query("UPDATE symposium_settings SET registration_deadline = ? WHERE id = 1", [deadline]);
        if (header_text) await promiseDb.query("UPDATE symposium_settings SET header_text = ? WHERE id = 1", [header_text]);
        if (symposium_title) await promiseDb.query("UPDATE symposium_settings SET symposium_title = ? WHERE id = 1", [symposium_title]);
        const [rows] = await promiseDb.query("SELECT * FROM symposium_settings WHERE id = 1");
        res.json({ success: true, settings: rows[0] });
    } catch (err) {
        res.status(500).json({ error: "Could not update settings" });
    }
});
app.get("/admin/grouped-teams",  verifyAdmin, async (req, res) => {
    const { eventName, college, token } = req.query;
    
    let sql = `
        SELECT se.team_token, s.name, s.reg_no, s.department, s.college 
        FROM student_events se
        JOIN students s ON se.student_id = s.id
        JOIN events e ON se.event_id = e.id
        WHERE e.event_name = ?`;
    
    const params = [eventName];
    if (college) { sql += " AND s.college = ?"; params.push(college); }
    if (token) { sql += " AND se.team_token LIKE ?"; params.push(`%${token}%`); }

    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "Group fetch failed" });
        
        // Transform flat rows into { "TOKEN123": [member1, member2], ... }
        const grouped = rows.reduce((acc, row) => {
            if (!acc[row.team_token]) acc[row.team_token] = [];
            acc[row.team_token].push(row);
            return acc;
        }, {});
        
        res.json(grouped);
    });
});
app.delete("/admin/delete-event", verifyAdmin, (req, res) => {
    const eventName = req.query.name;
    db.query("DELETE FROM events WHERE event_name = ?", [eventName], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});
app.post('/admin/add-event', verifyAdmin, (req, res) => {
    const { name, description, type, category, max_team_size } = req.body;
    if (!name || !type || !category) return res.status(400).json({ success: false, error: "Missing fields" });
    const sql = "INSERT INTO events (event_name, description, event_type, event_category, max_team_size) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [name, description, type, category, max_team_size], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.sqlMessage });
        res.json({ success: true });
    });
});
/* ---------- DATABASE CONNECTION TEST ---------- */
db.getConnection((err, connection) => {
    if (err) {
        console.error("❌ MySQL Connection Failed:", err.message);
    } else {
       console.log("✅ MySQL Connected Successfully to Aiven!");
        connection.release(); // Always release the connection back to the pool
    }
});
app.post("/admin/delete-all-students", verifyAdmin, async (req, res) => {
    const { password } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
        return res.json({ success: false });
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        // 1. Delete child table FIRST
        await connection.query("DELETE FROM student_events");
        await connection.query("DELETE FROM otp_verification");
        // 2. Then delete students
        await connection.query("DELETE FROM students");

        await connection.commit();

        res.json({ success: true });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.json({ success: false });
    } finally {
        connection.release();
    }
});
app.post("/api/update-contact",  verifyAdmin,async (req, res) => {
    try {
        const { email, phone, location, lat, lng } = req.body;

        await promiseDb.query(`
            UPDATE symposium_settings
            SET 
                contact_email = ?, 
                contact_phone = ?, 
                contact_location = ?, 
                contact_lat = ?, 
                contact_lng = ?
            WHERE id = 1
        `, [email, phone, location, lat, lng]);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Update failed" });
    }
});
app.get("/api/contact", async (req, res) => {
    try {
        const [rows] = await promiseDb.query(
            "SELECT contact_email, contact_phone, contact_location, contact_lat, contact_lng FROM symposium_settings WHERE id = 1"
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to load contact" });
    }
});
app.get('/admin/verify-session', verifyAdmin, (req, res) => {
    res.json({ success: true });
});
app.get("/api/public-settings", async (req, res) => {
    try {
        const [rows] = await promiseDb.query(
            "SELECT event_selection_limit, registration_deadline, header_text, symposium_title FROM symposium_settings WHERE id = 1"
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Could not load settings" });
    }
});
// Public — for registration form dropdowns
app.get("/api/departments", async (req, res) => {
    try {
        const [rows] = await promiseDb.query("SELECT * FROM departments ORDER BY name ASC");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

app.get("/api/degrees", async (req, res) => {
    const { level } = req.query;
    try {
        let query = "SELECT * FROM degrees ORDER BY name ASC";
        let params = [];
        if (level) { query = "SELECT * FROM degrees WHERE level = ? ORDER BY name ASC"; params = [level]; }
        const [rows] = await promiseDb.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

// Admin — manage departments
app.post("/admin/add-department", verifyAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false });
    try {
        await promiseDb.query("INSERT INTO departments (name) VALUES (?)", [name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.sqlMessage }); }
});

app.delete("/admin/delete-department", verifyAdmin, async (req, res) => {
    const { name } = req.query;
    try {
        await promiseDb.query("DELETE FROM departments WHERE name = ?", [name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Admin — manage degrees
app.post("/admin/add-degree", verifyAdmin, async (req, res) => {
    const { name, level } = req.body;
    if (!name || !level) return res.status(400).json({ success: false });
    try {
        await promiseDb.query("INSERT INTO degrees (name, level) VALUES (?, ?)", [name, level]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.sqlMessage }); }
});

app.delete("/admin/delete-degree", verifyAdmin, async (req, res) => {
    const { id } = req.query;
    try {
        await promiseDb.query("DELETE FROM degrees WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://localhost:${PORT}`));