const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");
require('dotenv').config();

const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MysqlStore } = require('wwebjs-mysql');
const mysqlPromise = require('mysql2/promise');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');

// 1. INITIALIZE EXPRESS
const app = express(); 

// 2. DEFINE CONFIG
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }, 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// 3. CREATE THE POOLS HERE (Crucial Step!)
const storePool = mysqlPromise.createPool(dbConfig); // <--- THIS MUST BE HERE
const db = mysql.createPool(dbConfig);
const promiseDb = db.promise();

// 4. NOW INITIALIZE WHATSAPP (Now storePool is ready to use)
const store = new MysqlStore({ pool: storePool }); 

const whatsapp = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000,
        clientId: 'symposium_2026'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// 5. WHATSAPP EVENTS
whatsapp.on('remote_session_saved', () => {
    console.log('✅ WhatsApp session successfully backed up to Aiven Cloud!');
});

whatsapp.on('qr', (qr) => {
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

whatsapp.on('ready', () => {
    console.log('WhatsApp Client is ready!');
});

whatsapp.initialize();

// 6. EMAIL CONFIGURATION
const transporter1 = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER_1, pass: process.env.EMAIL_PASS_1 }
});

const transporter2 = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER_2, pass: process.env.EMAIL_PASS_2 }
});

/* ---------- GLOBAL SETTINGS & MIDDLEWARE ---------- */
let globalSettings = { 
    event_selection_limit: 3,
    registration_deadline: "2026-03-15T09:00:00" 
};

let emailCounter = 0; // Added missing variable
const EMAIL_LIMIT = 450; // Added missing variable

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// ... Rest of your routes below (send-otp, register, etc.)

// NEW: Second pool specifically for the WhatsApp session store

cron.schedule('0 0 * * *', () => {
    console.log("🕛 Midnight: Resetting Daily Email Counter.");
    emailCounter = 0;
});

/* ---------- IMPROVED EMAIL SWITCHER ---------- */
async function sendSymposiumEmail(mailOptions) {
    emailCounter++;
    
    let activeTransporter;
    let activeEmail;

    if (emailCounter <= EMAIL_LIMIT) {
        // Use Account 1 (0 to 450)
        activeTransporter = transporter1;
        activeEmail = process.env.EMAIL_USER_1;
    } else if (emailCounter > EMAIL_LIMIT && emailCounter <= (EMAIL_LIMIT * 2)) {
        // Use Account 2 (451 to 900)
        activeTransporter = transporter2;
        activeEmail = process.env.EMAIL_USER_2;
    } else {
        // Critical: Both accounts exhausted (900+ emails)
        console.error("🚨 CRITICAL: Daily limit reached for ALL email accounts!");
        throw new Error("Daily registration limit reached. Please contact admin.");
    }

    console.log(`[Email Log] Using: ${activeEmail} | Today's Total: ${emailCounter}`);

    mailOptions.from = `"Symposium 2026" <${activeEmail}>`;
    return activeTransporter.sendMail(mailOptions);
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
/* ---------- REGISTRATION: STEP 3 - FINAL SUBMISSION ---------- */
app.post("/register", async (req, res) => {
    const { name, reg_no, college, department, year, email, phone, events } = req.body;
    const eventNames = events.map(e => e.name);
    
    try {
        const [eventRows] = await promiseDb.query("SELECT id, event_name FROM events WHERE event_name IN (?)", [eventNames]);
        const connection = await db.promise().getConnection();

        try {
            await connection.beginTransaction();

            // 1. Insert Student
            const [studentResult] = await connection.query(
                "INSERT INTO students (name, reg_no, college, department, year, email, phone) VALUES (?,?,?,?,?,?,?)", 
                [name, reg_no, college, department, year, email, phone]
            );
            const studentId = studentResult.insertId;

            // 2. Map Events and Tokens
            const mappingValues = eventRows.map(row => {
                const originalEvent = events.find(e => e.name.toLowerCase() === row.event_name.toLowerCase());
                const token = (originalEvent.token && originalEvent.token.trim() !== "") ? originalEvent.token.trim() : null;
                return [studentId, row.id, token];
            });

            await connection.query("INSERT INTO student_events (student_id, event_id, team_token) VALUES ?", [mappingValues]);
            
            // 3. Commit Transaction
            await connection.commit();

            // --- RESPOND TO USER IMMEDIATELY ---
            res.json({ success: true, redirect: "/registration-success.html" });
            console.log(`🚀 Registration instant-success for ${name}.`);

           // --- BACKGROUND PROCESSING (10 to 70 seconds delay) ---
const whatsappDelay = Math.floor(Math.random() * (70000 - 10000 + 1) + 10000);
            setTimeout(async () => {
                try {
                    // Fetch details using the main pool (promiseDb) because 'connection' is released
                    const [details] = await promiseDb.query(
                        `SELECT e.event_name, se.team_token FROM student_events se JOIN events e ON se.event_id = e.id WHERE se.student_id = ?`, 
                        [studentId]
                    );

                    const cleanPhone = phone.replace(/\D/g, '');
                    const chatId = `91${cleanPhone}@c.us`;

                   const whatsappMsg = 
    `*SYMPOSIUM 2026* 🚀\n` +
    `────────────────────\n` +
    `Hi *${name}*,\n` +
    `Your registration is *Confirmed!* 🎊\n\n` +
    `*📍 Registration Details:*\n` +
    `• *ID:* ${reg_no}\n` +
    `• *Inst:* ${college}\n\n` +
    `*📅 Events Enrolled:*\n` +
    `${details.map(d => `✅ ${d.event_name} _(${d.team_token || 'Solo'})_`).join('\n')}\n\n` +
    `────────────────────\n` +
    `*🔍 Track Your Team:* \n` +
    `Check your live team status  here:\n` +
    `👉 http://yourdomain.com/view-registration.html?reg=${reg_no}\n\n` +
    `_We look forward to seeing you!_ 💡`;

                    await whatsapp.sendMessage(chatId, whatsappMsg);
                    console.log(`✅ Background WhatsApp sent to ${name} after ${whatsappDelay/1000}s`);
                } catch (waErr) {
                    console.error("❌ Background WhatsApp Error:", waErr.message);
                }
            }, whatsappDelay);

        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release(); // Returns connection to pool so other users can use it
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
        // 1. Check if the student exists in the database
        const [students] = await promiseDb.query(
            "SELECT id, email, name, otp_count, last_otp_date FROM students WHERE reg_no = ?", 
            [reg_no]
        );
        
        if (students.length === 0) {
            return res.status(404).json({ message: "Register number not found" });
        }

        const student = students[0];
        // This gets the current date in YYYY-MM-DD format based on the server time
        const today = new Date().toISOString().split('T')[0]; 
        const dbDateString = student.last_otp_date ? 
            new Date(student.last_otp_date).toISOString().split('T')[0] : null;
        let currentCount = (dbDateString === today) ? (student.otp_count || 0) : 0;

 

       if (currentCount >= 1) {
            console.log(`🚫 Blocked: ${reg_no} reached daily limit of 3.`);
            return res.status(429).json({ 
                success: false, 
                message: "Daily limit reached. You can only request 3 OTPs per day." 
            });
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
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
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) res.json({ success: true, redirect: "admin.html" });
    else res.status(401).json({ success: false });
});

app.get("/admin/students", (req, res) => {
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

app.get("/admin/download", (req, res) => {
    db.query("SELECT s.name, s.reg_no, s.college, s.department, s.year FROM students s", (err, rows) => {
        if (err) return res.status(500).json({ error: "Download failed" });
        let csv = "Name,Register No,College,Department,Year\n";
        rows.forEach(r => { csv += `"${r.name}","${r.reg_no}","${r.college}","${r.department}","${r.year}"\n`; });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=Report.csv");
        res.send(csv);
    });
});

app.get("/api/settings", (req, res) => res.json(globalSettings));
app.post("/api/settings", (req, res) => {
    if (req.body.limit) globalSettings.event_selection_limit = parseInt(req.body.limit);
    if (req.body.deadline) globalSettings.registration_deadline = req.body.deadline;
    res.json({ success: true, settings: globalSettings });
});
app.get("/admin/grouped-teams", async (req, res) => {
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
app.delete("/admin/delete-event", (req, res) => {
    const eventName = req.query.name;
    db.query("DELETE FROM events WHERE event_name = ?", [eventName], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});
app.post('/admin/add-event', (req, res) => {
    const { name, description, type, max_team_size } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: "Missing fields" });
    const sql = "INSERT INTO events (event_name, description, event_type, max_team_size) VALUES (?, ?, ?, ?)";
    db.query(sql, [name, description, type, max_team_size], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.sqlMessage });
        res.json({ success: true });
    });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://localhost:${PORT}`));