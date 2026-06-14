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
const Razorpay = require('razorpay');
const crypto   = require('crypto');

const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


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
// ── Fetch symposium title from DB (with fallback) ──
async function getSymposiumTitle() {
    try {
        const [[row]] = await promiseDb.query(
            "SELECT symposium_title FROM symposium_settings WHERE id = 1"
        );
        return row?.symposium_title || "Symposium 2026";
    } catch {
        return "Symposium 2026";
    }
}
/*cron.schedule('0 0 * * *', () => {
    console.log("🕛 Midnight IST: Resetting Daily Email Counter.");
    emailCounter = 0;
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});*/
cron.schedule('0 2 * * *', async () => {
    try {
        await promiseDb.query(
            "DELETE FROM payment_temp WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)"
        );
        console.log("🧹 Cleaned up stale payment_temp entries");
    } catch (err) { console.error("Cleanup error:", err); }
}, { timezone: "Asia/Kolkata" });

async function sendSymposiumEmail(mailOptions) {
    // ── Fetch dynamic title for sender name ──
    const sympTitle = await getSymposiumTitle();
    
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    await promiseDb.query(
        `INSERT INTO email_usage (usage_date, count) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE count = count + 1`,
        [today]
    );

    const [[usage]] = await promiseDb.query(
        "SELECT count FROM email_usage WHERE usage_date = ?",
        [today]
    );

    const emailCounter = usage.count;

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
            sender: { name: sympTitle, email: account.email }, // ← now dynamic
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
       const sympTitle = await getSymposiumTitle();
       await sendSymposiumEmail({
    to: email,
    subject: `🔐 Registration OTP: ${otp}`,
    html: `
    <div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
        <div style="max-width: 500px; margin: 0 auto; background: #16262e; border: 1px solid rgba(0, 198, 255, 0.2); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
            <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">${sympTitle}</h1>
                <div style="height: 2px; width: 40px; background: #ffffff; margin: 10px auto; border-radius: 2px;"></div>
                <p style="color: #ffffff; margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Registration Verification</p>
            </div>
            <div style="padding: 40px 35px; text-align: center;">
                <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; font-weight: 600;">Complete Your Registration</h2>
                <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">
                    You're almost there! Use the secure code below to verify your email and complete your enrollment for ${sympTitle}:
                </p>
                <div style="background: rgba(0, 198, 255, 0.05); border: 1px dashed #00c6ff; border-radius: 18px; padding: 30px; margin: 30px 0;">
                    <span style="display: block; color: #00ffae; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 15px; font-weight: 800;">Double-Click to Copy</span>
            <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #ffffff; text-shadow: 0 0 20px rgba(0, 198, 255, 0.6); font-family: 'Courier New', monospace; display: block; padding: 10px 0; white-space: nowrap; user-select: all; -webkit-user-select: all;">
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
                    © ${sympTitle.toUpperCase()} ORGANIZING COMMITTEE<br>SECURED BY INNOVATION CELL
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
           "SELECT id, event_name, participant_limit, participant_count FROM events WHERE event_name IN (?)",
            [eventNames]
        );

        // ✅ FIX 3: Check that we actually found events in DB
        if (eventRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected events not found in database." });
        }
// ── BLOCK IF ANY EVENT IS FULL ──
for (const row of eventRows) {
    if (row.participant_limit !== null && row.participant_count >= row.participant_limit) {
        return res.status(409).json({
            success: false,
            message: `"${row.event_name}" is fully booked. No seats available.`
        });
    }
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
// ── INCREMENT COUNT FOR EACH REGISTERED EVENT ──
for (const row of eventRows) {
    await connection.query(
        "UPDATE events SET participant_count = participant_count + 1 WHERE id = ?",
        [row.id]
    );
}
            await connection.commit();

            res.json({ success: true, redirect: "/registration-success.html" });
            console.log(`🚀 Registration instant-success for ${name}.`);

            // Background email (unchanged)
            setTimeout(async () => {
                try {
                    const sympTitle = await getSymposiumTitle(); 
                   const [details] = await promiseDb.query(
    `SELECT e.event_name, e.event_category, e.event_type, se.team_token 
     FROM student_events se 
     JOIN events e ON se.event_id = e.id 
     WHERE se.student_id = ?`,
    [studentId]
);

                    const eventListHtml = details.map(d =>
                        `<li style="color: #ffffff; margin-bottom: 8px;">✅ <strong>${d.event_name}</strong> <span style="color: #8899a0; font-size: 13px;">(${d.team_token || 'Solo'})</span></li>`
                    ).join('');

          await sendSymposiumEmail({
    to: email,
    subject: `🎉 Registration Confirmed — ${name} | ${sympTitle}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#07111a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(160deg,#0f2027 0%,#203a43 50%,#0f2027 100%);min-height:100vh;padding:40px 20px;">
<tr><td align="center">
<table width="100%" style="max-width:580px;" cellpadding="0" cellspacing="0">

  <!-- HEADER GLOW LINE -->
  <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#00c6ff,#0072ff,#00c6ff,transparent);border-radius:3px 3px 0 0;"></td></tr>

  <!-- MAIN CARD -->
  <tr><td style="background:linear-gradient(180deg,#0d1f2d 0%,#111e2a 100%);border:1px solid rgba(0,198,255,0.15);border-top:none;border-radius:0 0 28px 28px;overflow:hidden;">

    <!-- TOP BANNER -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:linear-gradient(135deg,#00c6ff 0%,#0072ff 60%,#005fdb 100%);padding:36px 40px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:50px;padding:5px 18px;margin-bottom:14px;">
            <span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Official Confirmation</span>
          </div>
         <h1 style="color:#ffffff;margin:0 0 6px 0;font-size:28px;font-weight:800;letter-spacing:4px;text-transform:uppercase;text-shadow:0 2px 20px rgba(0,0,0,0.3);">${sympTitle}</h1>
          <div style="width:40px;height:2px;background:rgba(255,255,255,0.5);margin:16px auto 0;border-radius:2px;"></div>
        </td>
      </tr>
    </table>

    <!-- SUCCESS BADGE -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:32px 40px 0;text-align:center;">
          <div style="display:inline-block;background:rgba(0,255,174,0.08);border:1px solid rgba(0,255,174,0.3);border-radius:50px;padding:10px 24px;">
            <span style="color:#00ffae;font-size:13px;font-weight:700;letter-spacing:2px;">✓ &nbsp;REGISTRATION SUCCESSFUL</span>
          </div>
          <h2 style="color:#ffffff;font-size:22px;font-weight:600;margin:20px 0 6px;">Welcome aboard, ${name}!</h2>
          <p style="color:#6b8099;font-size:14px;margin:0;line-height:1.6;">Your registration has been confirmed and recorded in our system.</p>
        </td>
      </tr>
    </table>

    <!-- STUDENT DETAILS CARD -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:28px 40px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,198,255,0.04);border:1px solid rgba(0,198,255,0.12);border-radius:16px;overflow:hidden;">
            
            <!-- Section Title -->
            <tr>
              <td colspan="2" style="padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:#00c6ff;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">👤 &nbsp;Student Information</span>
              </td>
            </tr>

            <!-- Row 1 -->
            <tr>
              <td style="padding:12px 20px 0;width:50%;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Full Name</div>
                <div style="color:#e8f0f8;font-size:14px;font-weight:600;">${name}</div>
              </td>
              <td style="padding:12px 20px 0;width:50%;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Register No</div>
                <div style="color:#00ffae;font-size:14px;font-weight:700;font-family:monospace;letter-spacing:1px;">${reg_no}</div>
              </td>
            </tr>

            <!-- Row 2 -->
            <tr>
              <td style="padding:12px 20px 0;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">College</div>
                <div style="color:#e8f0f8;font-size:13px;">${college}</div>
              </td>
              <td style="padding:12px 20px 0;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Department</div>
                <div style="color:#e8f0f8;font-size:13px;">${department}</div>
              </td>
            </tr>

            <!-- Row 3 -->
            <tr>
              <td style="padding:12px 20px 0;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Degree &amp; Level</div>
                <div style="color:#e8f0f8;font-size:13px;">${degree} &nbsp;<span style="background:rgba(0,198,255,0.15);color:#00c6ff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;letter-spacing:1px;">${level}</span></div>
              </td>
              <td style="padding:12px 20px 0;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Year of Study</div>
                <div style="color:#e8f0f8;font-size:13px;">Year ${year}</div>
              </td>
            </tr>

            <!-- Row 4 -->
            <tr>
              <td style="padding:12px 20px 16px;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Email</div>
                <div style="color:#e8f0f8;font-size:13px;">${email}</div>
              </td>
              <td style="padding:12px 20px 16px;vertical-align:top;">
                <div style="color:#4a5a72;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Phone</div>
                <div style="color:#e8f0f8;font-size:13px;">${phone}</div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>

    <!-- EVENTS SECTION -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:20px 40px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,255,174,0.03);border:1px solid rgba(0,255,174,0.12);border-radius:16px;overflow:hidden;">
            
            <tr>
              <td style="padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:#00ffae;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">🎯 &nbsp;Registered Events</span>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 20px;">
                ${details.map((d, i) => {
                    const isGroup = d.team_token && !d.team_token.includes('-') === false;
                    const catColor = d.event_category === 'technical' ? '#4f8ef7' : '#a855f7';
                    const catBg    = d.event_category === 'technical' ? 'rgba(79,142,247,0.12)' : 'rgba(168,85,247,0.12)';
                    const catLabel = d.event_category === 'technical' ? '⚡ Technical' : '🎨 Non-Technical';
                    const typeBg   = d.event_type === 'group' ? 'rgba(251,191,36,0.12)' : 'rgba(0,229,190,0.12)';
                    const typeColor= d.event_type === 'group' ? '#fbbf24' : '#00e5be';
                    const typeLabel= d.event_type === 'group' ? '👥 Group' : '👤 Solo';
                    return `
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,255,174,0.03);border:1px solid rgba(0,255,174,0.12);border-radius:16px;overflow:hidden;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td>
                                <div style="color:#ffffff;font-size:14px;font-weight:700;margin-bottom:8px;">${d.event_name}</div>
                                <div>
                                  <span style="display:inline-block;background:${catBg};color:${catColor};font-size:9px;font-weight:700;letter-spacing:1.5px;padding:3px 10px;border-radius:4px;margin-right:6px;">${catLabel}</span>
                                  <span style="display:inline-block;background:${typeBg};color:${typeColor};font-size:9px;font-weight:700;letter-spacing:1.5px;padding:3px 10px;border-radius:4px;">${typeLabel}</span>
                                </div>
                              </td>
                              <td style="text-align:right;vertical-align:top;">
                                ${d.team_token ? `
                                <div style="color:#4a5a72;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Team Token</div>
                                <div style="color:#00ffae;font-size:12px;font-weight:800;font-family:monospace;background:rgba(0,255,174,0.08);border:1px solid rgba(0,255,174,0.2);padding:4px 10px;border-radius:6px;letter-spacing:2px;">${d.team_token}</div>
                                ` : `<span style="color:#4a5a72;font-size:11px;">Solo Entry</span>`}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>`;
                }).join('')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- IMPORTANT NOTE -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:20px 40px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(251,191,36,0.05);border:1px solid rgba(251,191,36,0.2);border-radius:12px;">
            <tr>
              <td style="padding:14px 18px;">
                <span style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:1px;">⚠ &nbsp;IMPORTANT —</span>
                <span style="color:#8899a0;font-size:12px;"> Please carry this email or your Register Number on the day of the symposium for verification.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- FOOTER -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:32px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);margin-top:28px;">
          <div style="margin-top:8px;">
            <div style="color:#2a3a4a;font-size:10px;letter-spacing:2px;text-transform:uppercase;line-height:1.8;">
              © ${sympTitle} Organizing Committee<br>
              <span style="color:#1e2d3d;">Secured by Innovation Cell</span>
            </div>
          </div>
        </td>
      </tr>
    </table>

  </td></tr>
  <!-- BOTTOM GLOW LINE -->
  <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#0072ff,#00c6ff,#0072ff,transparent);border-radius:0 0 3px 3px;"></td></tr>

</table>
</td></tr>
</table>

</body>
</html>`
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
       const sympTitle = await getSymposiumTitle();

await sendSymposiumEmail({
    to: student.email,
    subject: `🔐 Access Code: ${otp}`,
    html: `
<div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
    <div style="max-width: 500px; margin: 0 auto; background: #16262e; border: 1px solid rgba(0, 198, 255, 0.2); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
        <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">${sympTitle}</h1>
            <div style="height: 2px; width: 40px; background: #ffffff; margin: 10px auto; border-radius: 2px;"></div>
            <p style="color: #ffffff; margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Security Verification</p>
        </div>
        <div style="padding: 40px 35px; text-align: center;">
            <h2 style="color: #ffffff; font-size: 20px; margin-top: 0; font-weight: 600;">Verify Your Identity</h2>
            <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">
                To access your live registration status and digital pass for ${sympTitle}, please use the secure verification code below:
            </p>
            <div style="background: rgba(0, 198, 255, 0.05); border: 1px dashed #00c6ff; border-radius: 18px; padding: 30px; margin: 30px 0;"><span style="display: block; color: #00ffae; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 18px; font-weight: 800;"></span>  <span style="display: block; color: #00ffae; font-size: 11px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 15px; font-weight: 800;">Double-Click to Copy</span>
           <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #ffffff; text-shadow: 0 0 20px rgba(0, 198, 255, 0.6); font-family: 'Courier New', monospace; display: block; padding: 10px 0; white-space: nowrap; user-select: all; -webkit-user-select: all;">
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
                © ${sympTitle.toUpperCase()} ORGANIZING COMMITTEE<br>SECURED BY INNOVATION CELL
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
    db.query("SELECT id, event_name, description, event_type, event_category, max_team_size, coordinator_name, participant_limit, participant_count FROM events", (err, rows) => {
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
    SELECT 
        e.event_name, 
        e.event_category,
        e.event_type,
        se.team_token,
        (SELECT GROUP_CONCAT(s2.name SEPARATOR ', ') 
         FROM student_events se2 
         JOIN students s2 ON se2.student_id = s2.id 
         WHERE se2.team_token = se.team_token 
         AND se2.event_id = se.event_id) AS team_members
    FROM student_events se 
    JOIN events e ON se.event_id = e.id 
    WHERE se.student_id = ?
    ORDER BY e.event_category, e.event_type`, [student.id]);
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

// Find this in your /admin/students route and replace:
app.get("/admin/students", verifyAdmin, (req, res) => {
    const { year, department, college, event, reg_no, degree, level } = req.query;
    
    let sql = `
        SELECT 
            s.name, 
            s.reg_no, 
            s.college, 
            s.department, 
            s.year, 
            s.phone,
            s.degree,
            s.level,
            COALESCE(GROUP_CONCAT(DISTINCT e.event_name SEPARATOR ', '), 'None') AS events
        FROM students s
        LEFT JOIN student_events se ON s.id = se.student_id
        LEFT JOIN events e ON se.event_id = e.id
        WHERE 1=1 `;

    const params = [];
    if (reg_no)     { sql += " AND s.reg_no = ?";       params.push(reg_no); }
    if (year)       { sql += " AND s.year = ?";         params.push(year); }
    if (department) { sql += " AND s.department = ?";   params.push(department); }
    if (college)    { sql += " AND s.college = ?";      params.push(college); }
    if (event)      { sql += " AND e.event_name = ?";   params.push(event); }
    if (degree)     { sql += " AND s.degree = ?";       params.push(degree); }
    if (level)      { sql += " AND s.level = ?";        params.push(level); }

    sql += " GROUP BY s.id ORDER BY s.id DESC";

    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "Load failed" });
        res.json(rows);
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
        if (req.body.fee_description !== undefined) await promiseDb.query("UPDATE symposium_settings SET fee_description = ? WHERE id = 1", [req.body.fee_description]);
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
        // Add these two lines alongside the existing if(limit), if(deadline) etc:
if (req.body.fee_enabled !== undefined) await promiseDb.query("UPDATE symposium_settings SET fee_enabled = ? WHERE id = 1", [req.body.fee_enabled ? 1 : 0]);
if (req.body.fee_amount  !== undefined) await promiseDb.query("UPDATE symposium_settings SET fee_amount = ? WHERE id = 1",  [parseFloat(req.body.fee_amount) || 0]);
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
   const { name, description, type, category, max_team_size, coordinator_password, coordinator_name, participant_limit } = req.body;
    if (!name || !type || !category) return res.status(400).json({ success: false, error: "Missing fields" });
  const sql = `INSERT INTO events 
    (event_name, description, event_type, event_category, max_team_size, coordinator_password, coordinator_name, participant_limit, participant_count) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`;
const limitVal = (participant_limit && parseInt(participant_limit) > 0) ? parseInt(participant_limit) : null;
db.query(sql, [name, description, type, category, max_team_size, coordinator_password || null, coordinator_name || null, limitVal], (err) => {
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
        await connection.query("UPDATE events SET participant_count = 0");

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
          "SELECT contact_email, contact_phone, contact_location, contact_lat, contact_lng, fee_enabled, fee_amount, fee_description FROM symposium_settings WHERE id = 1"
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
          "SELECT event_selection_limit, registration_deadline, header_text, symposium_title, fee_enabled, fee_amount, fee_description FROM symposium_settings WHERE id = 1"
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
// Get year settings (public — for registration form)
app.get("/api/year-settings", async (req, res) => {
    try {
        const [rows] = await promiseDb.query("SELECT * FROM year_settings");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

// Update year settings (admin only)
app.post("/admin/update-year-settings", verifyAdmin, async (req, res) => {
    const { level, max_years } = req.body;
    if (!level || !max_years) return res.status(400).json({ success: false });
    try {
        await promiseDb.query(
            "INSERT INTO year_settings (level, max_years) VALUES (?, ?) ON DUPLICATE KEY UPDATE max_years = ?",
            [level, max_years, max_years]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.sqlMessage }); }
});
// Lightweight ping route for cron-job.org
app.get("/ping", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});
// Coordinator login
app.post("/coordinator/login", async (req, res) => {
    const { event_name, password } = req.body;
    if (!event_name || !password) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }
    try {
        const [rows] = await promiseDb.query(
            "SELECT id, event_name, event_type, event_category, coordinator_password, coordinator_name FROM events WHERE event_name = ?",
            [event_name]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }
        const event = rows[0];
        if (!event.coordinator_password || event.coordinator_password !== password) {
            return res.status(401).json({ success: false, message: "Invalid password" });
        }
      const token = jwt.sign(
    { role: "coordinator", event_name: event.event_name, event_type: event.event_type, event_id: event.id, coordinator_name: event.coordinator_name || "" },
    JWT_SECRET, { expiresIn: "8h" }
);
res.json({
    success: true, token,
    event_name: event.event_name,
    event_type: event.event_type,
    coordinator_name: event.coordinator_name || "",
    participant_limit: event.participant_limit,      // ADD
    participant_count: event.participant_count       // ADD
});
    } catch (err) {
        console.error("Coordinator login error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Coordinator middleware
function verifyCoordinator(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(403).json({ message: "No token" });
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== "coordinator") return res.status(403).json({ message: "Not a coordinator" });
        req.coordinator = decoded;
        next();
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}

// Coordinator — get their event's students
app.get("/coordinator/students", verifyCoordinator, async (req, res) => {
    const { department, degree, level, year, college } = req.query;
    const event_name = req.coordinator.event_name;
    const event_type = req.coordinator.event_type;

    try {
        if (event_type === "group") {
            // Grouped team view
            let sql = `
                SELECT se.team_token, s.name, s.reg_no, s.department, s.college, s.degree, s.level, s.year
                FROM student_events se
                JOIN students s ON se.student_id = s.id
                JOIN events e ON se.event_id = e.id
                WHERE e.event_name = ?`;
            const params = [event_name];
            if (college) { sql += " AND s.college = ?"; params.push(college); }
            const [rows] = await promiseDb.query(sql, params);
            const grouped = rows.reduce((acc, row) => {
                if (!acc[row.team_token]) acc[row.team_token] = [];
                acc[row.team_token].push(row);
                return acc;
            }, {});
            return res.json({ type: "group", data: grouped });
        } else {
            // Solo view
            let sql = `
                SELECT s.name, s.reg_no, s.college, s.department, s.degree, s.level, s.year
                FROM student_events se
                JOIN students s ON se.student_id = s.id
                JOIN events e ON se.event_id = e.id
                WHERE e.event_name = ?`;
            const params = [event_name];
            if (department) { sql += " AND s.department = ?"; params.push(department); }
            if (degree)     { sql += " AND s.degree = ?";     params.push(degree); }
            if (level)      { sql += " AND s.level = ?";      params.push(level); }
            if (year)       { sql += " AND s.year = ?";       params.push(year); }
            if (college)    { sql += " AND s.college = ?";    params.push(college); }
            sql += " ORDER BY s.name ASC";
            const [rows] = await promiseDb.query(sql, params);
            return res.json({ type: "solo", data: rows });
        }
    } catch (err) {
        console.error("Coordinator students error:", err);
        res.status(500).json({ error: "Failed to load students" });
    }
});

// Public — get all events (for coordinator login dropdown)
app.get("/api/events-list", async (req, res) => {
    try {
        const [rows] = await promiseDb.query(
            "SELECT event_name, event_type, event_category FROM events ORDER BY event_name ASC"
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});
// Admin only — events with coordinator passwords
app.get("/admin/events-with-passwords", verifyAdmin, (req, res) => {
    db.query("SELECT * FROM events ORDER BY event_category, event_name", (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed" });
        res.json(rows);
    });
});
app.post('/admin/update-event-limit', verifyAdmin, async (req, res) => {
    const { eventName, participant_limit } = req.body;
    if (!eventName) return res.status(400).json({ success: false });
    try {
        const limitVal = (participant_limit && parseInt(participant_limit) > 0) ? parseInt(participant_limit) : null;
        await promiseDb.query(
            "UPDATE events SET participant_limit = ? WHERE event_name = ?",
            [limitVal, eventName]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.sqlMessage });
    }
});
app.get("/coordinator/event-info", verifyCoordinator, async (req, res) => {
    const event_name = req.coordinator.event_name;
    try {
        const [[row]] = await promiseDb.query(
            "SELECT participant_limit, participant_count FROM events WHERE event_name = ?",
            [event_name]
        );
        res.json(row || { participant_limit: null, participant_count: 0 });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});
/* ---------- PAYMENT: CREATE ORDER ---------- */
app.post("/payment/create-order", async (req, res) => {
    const { student_data, events_data, amount } = req.body;
    if (!student_data || !events_data || !amount) {
        return res.status(400).json({ success: false, message: "Missing data" });
    }
    try {
        const order = await razorpay.orders.create({
            amount:   Math.round(parseFloat(amount) * 100), // paise
            currency: "INR",
            receipt:  `sym_${Date.now()}`
        });

        // Store student + events data temporarily against this order
        await promiseDb.query(
            "INSERT INTO payment_temp (order_id, student_data, events_data, amount) VALUES (?, ?, ?, ?)",
            [order.id, JSON.stringify(student_data), JSON.stringify(events_data), amount]
        );

        res.json({ success: true, order_id: order.id, amount: order.amount, key: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
        console.error("❌ Create order error:", err);
        res.status(500).json({ success: false, message: "Could not create payment order" });
    }
});

/* ---------- PAYMENT: VERIFY + REGISTER ---------- */
app.post("/payment/verify", async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // 1. Verify signature
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

    if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: "Payment verification failed. Invalid signature." });
    }

    // 2. Fetch stored student + events data
    const [rows] = await promiseDb.query(
        "SELECT * FROM payment_temp WHERE order_id = ?",
        [razorpay_order_id]
    );

    if (rows.length === 0) {
        return res.status(404).json({ success: false, message: "Order not found" });
    }

    const { student_data, events_data } = rows[0];
const studentData = typeof student_data === 'string' ? JSON.parse(student_data) : student_data;
const eventsData  = typeof events_data  === 'string' ? JSON.parse(events_data)  : events_data;
    const { name, reg_no, college, department, year, level, degree, email, phone } = studentData;
    const events = eventsData;

    // 3. Run registration (same logic as /register)
    try {
        const eventNames = events.map(e => e.name || e.event_name).filter(Boolean);

        const [eventRows] = await promiseDb.query(
            "SELECT id, event_name, participant_limit, participant_count FROM events WHERE event_name IN (?)",
            [eventNames]
        );

        if (eventRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected events not found." });
        }

        // Check capacity
        for (const row of eventRows) {
            if (row.participant_limit !== null && row.participant_count >= row.participant_limit) {
                return res.status(409).json({ success: false, message: `"${row.event_name}" is now fully booked.` });
            }
        }

        const connection = await db.promise().getConnection();
        try {
            await connection.beginTransaction();

            const [studentResult] = await connection.query(
                "INSERT INTO students (name, reg_no, college, department, year, email, phone, degree, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [name, reg_no, college, department, year, email, phone, degree, level]
            );
            const studentId = studentResult.insertId;

            const mappingValues = [];
            for (const row of eventRows) {
                const originalEvent = events.find(e =>
                    (e.name || e.event_name || '').toLowerCase() === row.event_name.toLowerCase()
                );
                if (!originalEvent) continue;
                const token = (originalEvent.token && originalEvent.token.trim() !== "")
                    ? originalEvent.token.trim() : null;
                mappingValues.push([studentId, row.id, token]);
            }

            if (mappingValues.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ success: false, message: "Could not map events." });
            }

            await connection.query(
                "INSERT INTO student_events (student_id, event_id, team_token) VALUES ?",
                [mappingValues]
            );

            for (const row of eventRows) {
                await connection.query(
                    "UPDATE events SET participant_count = participant_count + 1 WHERE id = ?",
                    [row.id]
                );
            }

            // Clean up temp record
            await connection.query("DELETE FROM payment_temp WHERE order_id = ?", [razorpay_order_id]);

            await connection.commit();

            res.json({ success: true });
            console.log(`✅ Paid registration complete for ${name} | Payment: ${razorpay_payment_id}`);

            // Background confirmation email
            setTimeout(async () => {
                try {
                    const sympTitle = await getSymposiumTitle();
                    const [details] = await promiseDb.query(
                        `SELECT e.event_name, e.event_category, e.event_type, se.team_token 
                         FROM student_events se 
                         JOIN events e ON se.event_id = e.id 
                         WHERE se.student_id = ?`,
                        [studentId]
                    );
                    await sendSymposiumEmail({
                        to: email,
                        subject: `🎉 Registration Confirmed — ${name} | ${sympTitle}`,
                        html: `<p>Hi ${name}, your registration and payment are confirmed! Payment ID: ${razorpay_payment_id}</p>`
                    });
                } catch (mailErr) {
                    console.error("❌ Post-payment email error:", mailErr.message);
                }
            }, 2000);

        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error("❌ Payment verify + register error:", err);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Registration failed after payment" });
    }
});
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
);