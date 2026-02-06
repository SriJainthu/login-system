const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
require('dotenv').config(); 
const app = express();
const axios = require("axios");
const nodemailer = require("nodemailer");

/* ---------- EMAIL CONFIG ---------- */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ Email Server Error:", error);
  } else {
    console.log("✅ Email Server is ready to send messages");
  }
});

const otpStore = {}; // TEMP storage for both registration and viewing
let globalSettings = { 
    event_selection_limit: 3,
    registration_deadline: "2026-03-15T09:00:00" // Default value
};
/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

/* ---------- DEADLINE CHECKER ---------- */
const checkDeadline = (req, res, next) => {
    const now = new Date();
    const deadline = new Date(globalSettings.registration_deadline);
    
    if (now > deadline) {
        return res.status(403).json({ 
            success: false, 
            message: "Registration has officially closed. Better luck next year!" 
        });
    }
    next();
};

/* ---------- DATABASE ---------- */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false // This is the secret sauce for Aiven!
  }
});
db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    return;
  }
  console.log("✅ MySQL connected");
});

/* ---------- EVENTS ---------- */
app.get("/events", (req, res) => {
  db.query("SELECT * FROM events", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch events" });
    }
    res.json(rows);
  });
});

/* ---------- REGISTRATION: STEP 1 - SEND OTP ---------- */
app.post("/register/send-otp", checkDeadline, (req, res) => {
    const { email, reg_no } = req.body;

    if (!email || !reg_no) {
        return res.status(400).json({ message: "Email and Register Number are required" });
    }

    const checkQuery = `SELECT email, reg_no FROM students WHERE email = ? OR reg_no = ?`;
    db.query(checkQuery, [email, reg_no], (err, existing) => {
        if (err) return res.status(500).json({ message: "Database error" });

        if (existing.length > 0) {
            const isEmail = existing.some(row => row.email === email);
            const msg = isEmail ? "This Email is already registered!" : "This Register Number is already registered!";
            return res.status(409).json({ success: false, exists: true, message: msg });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000 };

       const mailOptions = {
    from: `"Symposium 2026" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `🔐 ${otp} is your Symposium Verification Code`,
    html: `
    <div style="background-color: #0f2027; padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(145deg, #162a31, #0f2027); border: 1px solid #00c6ff33; border-radius: 20px; padding: 40px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
            
            <div style="margin-bottom: 30px;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">
                    SYMPOSIUM <span style="color: #00c6ff;">2026</span>
                </h1>
                <div style="height: 2px; width: 50px; background: #00ffae; margin: 15px auto 0;"></div>
            </div>

            <h2 style="color: #ffffff; font-weight: 300; margin-bottom: 10px;">Verify Your Identity</h2>
            <p style="color: #8899a0; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                To access your live registration status and digital pass, please use the secure verification code below:
            </p>

            <div style="background: rgba(255, 255, 255, 0.05); border: 1px dashed #00c6ff; border-radius: 12px; padding: 25px; margin: 30px 0;">
                <span style="display: block; color: #00ffae; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 10px;">Your One-Time Code</span>
                <div style="font-size: 42px; font-weight: 700; letter-spacing: 12px; color: #ffffff; text-shadow: 0 0 15px rgba(0, 198, 255, 0.5);">
                    ${otp}
                </div>
            </div>

            <p style="color: #5d7079; font-size: 13px; line-height: 1.5;">
                This code is valid for 10 minutes. <br>
                If you did not request this, please ignore this email.
            </p>

            <div style="margin-top: 40px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                <p style="color: #44555e; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">
                    © 2026 Symposium Organizing Committee
                </p>
            </div>
        </div>
    </div>`
};
        transporter.sendMail(mailOptions, (error) => {
            if (error) return res.status(500).json({ message: "Failed to send email" });
            res.json({ success: true, message: "OTP sent!" });
        });
    });
});

/* ---------- REGISTRATION: STEP 2 - VERIFY OTP ---------- */
app.post("/register/verify-otp", (req, res) => {
    const { email, otp } = req.body;
    const record = otpStore[email];

    if (!record) return res.status(400).json({ message: "No OTP found. Request again." });
    if (Date.now() > record.expires) {
        delete otpStore[email];
        return res.status(400).json({ message: "OTP has expired." });
    }
    if (record.otp !== otp) return res.status(400).json({ message: "Invalid verification code." });

    delete otpStore[email]; 
    res.json({ success: true, message: "Email verified successfully!" });
});

/* ---------- REGISTRATION: STEP 3 - FINAL SUBMISSION ---------- */
app.post("/register", (req, res) => {
    const { name, reg_no, college, department, year, email, phone, events } = req.body;

    if (!name || !reg_no || !email || !events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const eventNames = events.map(e => e.name);
    db.query("SELECT id, event_name, max_team_size FROM events WHERE event_name IN (?)", [eventNames], (err, eventRows) => {
        if (err || eventRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected events are invalid" });
        }

        const checkPromises = events.map(selectedEvent => {
            return new Promise((resolve, reject) => {
                if (selectedEvent.token && selectedEvent.token.trim() !== "") {
                    const eventDetail = eventRows.find(r => 
                        r.event_name.trim().toLowerCase() === selectedEvent.name.trim().toLowerCase()
                    );
                    
                    if (!eventDetail) return resolve();

                    const countQuery = "SELECT COUNT(*) as currentCount FROM student_events WHERE team_token = ? AND event_id = ?";
                    db.query(countQuery, [selectedEvent.token.trim(), eventDetail.id], (err, countResult) => {
                        if (err) return reject(err);
                        
                        const currentMembers = countResult[0].currentCount;
                        if (currentMembers >= eventDetail.max_team_size) {
                            return reject({ 
                                isLimitError: true, 
                                message: `Team limit reached for ${eventDetail.event_name}. Maximum ${eventDetail.max_team_size} members allowed.` 
                            });
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });

        // FIXED: Added .catch() here to prevent the UnhandledPromiseRejection crash
        Promise.all(checkPromises)
            .then(() => {
                db.beginTransaction((err) => {
                    if (err) return res.status(500).json({ success: false, message: "Transaction Error" });

                    const insertStudent = `INSERT INTO students (name, reg_no, college, department, year, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                    db.query(insertStudent, [name, reg_no, college, department, year, email, phone], (err, result) => {
                        if (err) {
                            return db.rollback(() => {
                                const msg = (err.code === "ER_DUP_ENTRY") ? "Student already registered!" : "Database Error";
                                res.status(409).json({ success: false, message: msg });
                            });
                        }

                        const studentId = result.insertId;
                        const mappingValues = eventRows.map(row => {
    const originalEvent = events.find(e => 
        e.name.trim().toLowerCase() === row.event_name.trim().toLowerCase()
    );
    
    // FIX: If token is present (either from user or generated by frontend), use it.
    // If it's truly null/empty, then it's a Solo Event.
    const token = (originalEvent.token && originalEvent.token.trim() !== "") 
                  ? originalEvent.token.trim() 
                  : null;

    return [studentId, row.id, token];
});

                        const insertEventsQuery = "INSERT INTO student_events (student_id, event_id, team_token) VALUES ?";
                        db.query(insertEventsQuery, [mappingValues], (err) => {
                            if (err) return db.rollback(() => res.status(500).json({ success: false, message: "Event mapping failed" }));

                            db.commit((err) => {
                                if (err) return db.rollback(() => res.status(500).json({ success: false, message: "Commit failed" }));

                                // --- FIND THIS BLOCK AND REPLACE IT ---
                             // Inside the db.commit block...

const eventListHtml = events.map(userSelectedEvent => {
    // 1. Identify if it's a group event based on token presence
    const tokenValue = userSelectedEvent.token;
    const isGroup = (tokenValue && tokenValue.trim() !== "");
    
    // 2. Styling and Label logic
    const accentColor = isGroup ? "#00c6ff" : "#00ffae";
    const typeLabel = isGroup ? "GROUP EVENT" : "SOLO EVENT";
    const idLabel = isGroup ? "Group ID" : "Type";
    const idValue = isGroup ? tokenValue : "Individual";

    return `
        <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-left: 4px solid ${accentColor}; padding: 15px; margin-bottom: 12px; border-radius: 10px;">
            <div style="margin-bottom: 5px;">
                <span style="color: #ffffff; font-size: 16px; font-weight: 700; letter-spacing: 0.5px;">${userSelectedEvent.name.toUpperCase()}</span>
                <span style="float: right; font-size: 9px; color: ${accentColor}; font-weight: 800; letter-spacing: 1px; border: 1px solid ${accentColor}; padding: 2px 5px; border-radius: 4px;">${typeLabel}</span>
            </div>
            <div style="clear: both;"></div>
            <div style="margin-top: 8px; font-size: 13px;">
                <span style="color: #8899a0; font-weight: 600;">${idLabel}: </span>
                <span style="color: #ffffff; font-family: monospace; font-size: 14px; font-weight: bold;">${idValue}</span>
            </div>
        </div>`;
}).join('');
// Change this to your actual production domain when you go live
const BASE_URL = "http://localhost:3000"; 

const mailOptions = {
    from: `"Symposium 2026 Team" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `✔️ Registration Confirmed: ${reg_no} | Symposium 2026`,
    html: `
    <div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
        
        <div style="max-width: 600px; margin: 0 auto; background: #16262e; border: 1px solid rgba(255,255,255,0.1); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
            
            <div style="background: linear-gradient(90deg, #00c6ff 0%, #0072ff 100%); padding: 40px 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 3px; font-weight: 800; text-transform: uppercase;">SYMPOSIUM <span style="color: #0b1419; opacity: 0.7;">2026</span></h1>
                <div style="height: 2px; width: 60px; background: #ffffff; margin: 15px auto; border-radius: 2px;"></div>
                <p style="color: #ffffff; margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Official Registration Receipt</p>
            </div>

            <div style="padding: 40px 35px;">
                <p style="color: #ffffff; font-size: 18px; margin-top: 0; font-weight: 600;">Hello ${name},</p>
                <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">Your registration for Symposium 2026 has been successfully processed. Please keep this digital receipt for your records during the event.</p>

                <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 18px; padding: 25px; margin: 30px 0;">
                    <table width="100%" cellspacing="0" cellpadding="8">
                        <tr>
                            <td style="color: #556a75; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 800;">Register No</td>
                            <td style="color: #00ffae; font-size: 15px; font-weight: 700; text-align: right; font-family: 'Courier New', monospace;">${reg_no}</td>
                        </tr>
                        <tr>
                            <td style="color: #556a75; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 800;">Department</td>
                            <td style="color: #ffffff; font-size: 14px; text-align: right;">${department}</td>
                        </tr>
                        <tr>
                            <td style="color: #556a75; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 800;">College</td>
                            <td style="color: #ffffff; font-size: 14px; text-align: right;">${college}</td>
                        </tr>
                    </table>
                </div>

                <div style="margin-top: 40px;">
                    <h3 style="color: #00c6ff; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; font-weight: 800; border-left: 4px solid #00c6ff; padding-left: 12px;">Enrolled Events</h3>
                    ${eventListHtml}
                </div>

                <div style="text-align: center; margin-top: 45px;">
                    <a href="${process.env.BASE_URL || 'http://localhost:3000'}/view-registration.html" 
                       style="display: inline-block; background: #00c6ff; color: #0b1419; text-decoration: none; padding: 18px 40px; border-radius: 15px; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 10px 30px rgba(0, 198, 255, 0.3);">
                       View Live Status
                    </a>
                    <p style="color: #556a75; font-size: 12px; margin-top: 20px;">Check your team status and event timings online.</p>
                </div>
            </div>

            <div style="background: rgba(0, 0, 0, 0.2); padding: 30px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                <p style="color: #44555e; font-size: 11px; margin: 0; line-height: 1.5;">
                    This is an automated message from the Symposium Innovation Cell.<br>
                    Questions? Contact us at <a href="mailto:support@symposium2026.com" style="color: #00c6ff; text-decoration: none;">support@symposium2026.com</a>
                </p>
                <p style="color: #33444d; font-size: 10px; margin-top: 15px; font-weight: bold;">© 2026 SYMPOSIUM TECH TEAM</p>
            </div>
        </div>
    </div>`
};

                               transporter.sendMail(mailOptions, (mailErr) => {
    if (mailErr) {
        console.error("❌ Mail Error:", mailErr);
        // Even if mail fails, we usually want to tell the user the DB part worked
    }
    
    // This sends the signal back to your registration.html
    res.json({ 
        success: true, 
        message: "Registration successful!",
        redirect: "registration-success.html" // Pass the target page here
    });
});
                            });
                        });
                    });
                });
            })
            .catch(error => {
                // FIXED: This catches the team limit error and sends it to the frontend instead of crashing
                console.error("⚠️ Validation Error:", error.message || error);
                res.status(400).json({ success: false, message: error.message || "Team limit exceeded." });
            });
    });
});
/* ---------- ADMIN : FILTERED STUDENTS (Updated for Solo/Group) ---------- */
app.get("/admin/students", (req, res) => {
  const { year, department, college, event, reg_no, regType } = req.query;
  
  let query = `
    SELECT s.id, s.name, s.reg_no, s.college, s.department, s.year, s.email, s.phone,
    COALESCE(GROUP_CONCAT(CONCAT(e.event_name, IF(se.team_token IS NOT NULL AND se.team_token != '', CONCAT(' [', se.team_token, ']'), '')) SEPARATOR ', '), 'No events') AS events
    FROM students s
    LEFT JOIN student_events se ON s.id = se.student_id
    LEFT JOIN events e ON se.event_id = e.id
    WHERE 1=1 `;

  const params = [];

  if (reg_no) { query += " AND s.reg_no = ?"; params.push(reg_no); }
  if (year) { query += " AND s.year = ?"; params.push(year); }
  if (department) { query += " AND s.department = ?"; params.push(department); }
  if (college) { query += " AND s.college = ?"; params.push(college); }
  if (event) { query += " AND e.event_name = ?"; params.push(event); }

  // --- NEW: Solo/Group Filter Logic ---
  if (regType === "solo") {
    query += " AND (se.team_token IS NULL OR se.team_token = '') ";
  } else if (regType === "group") {
    query += " AND (se.team_token IS NOT NULL AND se.team_token != '') ";
  }

  query += " GROUP BY s.id ORDER BY s.id DESC";

  db.query(query, params, (err, rows) => {
    if (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to load students" });
    }
    res.json(rows);
  });
});
/* ---------- ADMIN : COMPATIBILITY ROUTE ---------- */
/* ---------- ADMIN : SMART CSV DOWNLOAD ---------- */
app.get("/admin/download", (req, res) => {
  const { year, department, college, event } = req.query;
  let query = `
    SELECT s.name, s.reg_no, s.college, s.department, s.year,
    COALESCE(GROUP_CONCAT(CONCAT(e.event_name, IF(se.team_token != '', CONCAT(' (', se.team_token, ')'), '')) SEPARATOR ', '), '') AS events
    FROM students s
    LEFT JOIN student_events se ON s.id = se.student_id
    LEFT JOIN events e ON se.event_id = e.id
    WHERE 1=1 `;
  const params = [];
  if (year) { query += " AND s.year = ?"; params.push(year); }
  if (department) { query += " AND s.department = ?"; params.push(department); }
  if (college) { query += " AND s.college = ?"; params.push(college); }
  if (event) { query += " AND e.event_name = ?"; params.push(event); }
  query += " GROUP BY s.id";
  db.query(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Download failed" });
    let csv = "";
    let filename = event ? `${event.replace(/\s+/g, '_')}_Participants.csv` : "Full_Registration_Report.csv";
    if (event) {
      csv = "Name,Register No,Department,Year\n";
      rows.forEach(r => csv += `"${r.name}","${r.reg_no}","${r.department}","${r.year}"\n`);
    } else {
      csv = "Name,Register No,College,Department,Year,Events\n";
      rows.forEach(r => csv += `"${r.name}","${r.reg_no}","${r.college}","${r.department}",${r.year},"${r.events}"\n`);
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.send(csv);
  });
});

/* ---------- VIEW REGISTRATION: SEND & VERIFY OTP ---------- */
app.post("/send-otp", (req, res) => {
  const { reg_no } = req.body;
  db.query("SELECT email FROM students WHERE reg_no = ?", [reg_no], (err, rows) => {
    if (err || rows.length === 0) return res.status(404).json({ message: "Register number not found" });
    const email = rows[0].email;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[reg_no] = { otp, expires: Date.now() + 5 * 60 * 1000 };
    const mailOptions = {
      from: `"Symposium Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verification Code",
      html: `<h2>Your Code: ${otp}</h2>`
    };
    transporter.sendMail(mailOptions, (error) => {
      if (error) return res.status(500).json({ message: "Email failed" });
      res.json({ success: true, message: "Code sent!" });
    });
  });
});

app.post("/verify-otp", (req, res) => {
  const { reg_no, otp } = req.body;
  const record = otpStore[reg_no];
  if (record && record.otp === otp && Date.now() < record.expires) {
    delete otpStore[reg_no];
    res.json({ success: true });
  } else res.status(400).json({ message: "Invalid or expired OTP" });
});

/* ---------- VIEW REGISTRATION: GET DATA & LIVE TEAM STATUS ---------- */
app.get("/registration/:reg_no", (req, res) => {
    const reg_no = req.params.reg_no.trim(); 

    // 1. Find the student
    db.query("SELECT * FROM students WHERE reg_no = ?", [reg_no], (err, students) => {
        if (err || students.length === 0) {
            return res.status(404).json({ message: "No registration found for this number" });
        }

        const student = students[0];
        const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. Optimized Query: Get events AND all member names for the same token
        const eventQuery = `
            SELECT 
                e.event_name, 
                se.team_token,
                (
                    SELECT GROUP_CONCAT(s2.name SEPARATOR ', ')
                    FROM student_events se2
                    JOIN students s2 ON se2.student_id = s2.id
                    WHERE se2.team_token = se.team_token AND se2.event_id = se.event_id
                ) AS team_members
            FROM student_events se 
            JOIN events e ON se.event_id = e.id 
            WHERE se.student_id = ?`;

        db.query(eventQuery, [student.id], (err, events) => {
            if (err) return res.status(500).json({ message: "Error fetching team details" });

            // 3. Send Email with OTP
            const mailOptions = {
    from: `"Symposium 2026 Team" <${process.env.EMAIL_USER}>`,
    to: student.email,
    subject: `🔐 Your Access Code: ${generatedOTP}`,
    html: `
    <div style="background-color: #0f2027; background: linear-gradient(180deg, #0f2027 0%, #203a43 100%); padding: 50px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; text-align: center;">
        
        <div style="max-width: 450px; margin: 0 auto; background: #16262e; border: 1px solid rgba(0, 198, 255, 0.2); border-radius: 28px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);">
            
            <div style="padding: 30px 0 10px;">
                <div style="display: inline-block; background: rgba(0, 198, 255, 0.1); padding: 15px; border-radius: 50%; margin-bottom: 10px;">
                    <span style="font-size: 30px;">🔐</span>
                </div>
                <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px; text-transform: uppercase; font-weight: 800;">Security <span style="color: #00c6ff;">Access</span></h2>
            </div>

            <div style="padding: 20px 35px 40px;">
                <p style="color: #8899a0; font-size: 15px; line-height: 1.6;">Hello <b>${student.name}</b>,<br>Use the secure code below to access your dashboard and download your boarding pass.</p>

                <div style="margin: 30px 0; background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(0, 198, 255, 0.4); border-radius: 18px; padding: 25px;">
                    <div style="font-family: 'Courier New', monospace; font-size: 38px; font-weight: 900; color: #00ffae; letter-spacing: 8px; text-shadow: 0 0 10px rgba(0, 255, 174, 0.3);">
                        ${generatedOTP}
                    </div>
                    <p style="color: #556a75; font-size: 11px; margin-top: 10px; text-transform: uppercase; letter-spacing: 1px;">Expires in 10 minutes</p>
                </div>

                <div style="background: rgba(0, 0, 0, 0.2); border-radius: 12px; padding: 15px; text-align: left;">
                    <p style="font-size: 12px; color: #8899a0; margin: 0; line-height: 1.4;">
                        <span style="color: #00c6ff; font-weight: bold;">Note:</span> Your boarding pass displays your personal details. To see live teammate lists, visit the dashboard.
                    </p>
                </div>
            </div>

            <div style="background: rgba(0, 0, 0, 0.2); padding: 20px; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                <p style="color: #44555e; font-size: 10px; margin: 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
                    © 2026 Symposium Tech Team • Secured Entry
                </p>
            </div>
        </div>
    </div>`
};

            transporter.sendMail(mailOptions, (mailErr) => {
                if (mailErr) {
                    console.error("❌ Mail send failed:", mailErr);
                    return res.status(500).json({ message: "Failed to send verification email." });
                }

                // 4. Return data to frontend
                // team_members will now be a string like "John Doe, Jane Smith"
                res.json({ 
                    student: student, 
                    events: events, 
                    secret: generatedOTP 
                });
            });
        });
    });
});
/* ---------- ADMIN: UPDATE LIMITS & ADD EVENT ---------- */
app.get("/admin/events-config", (req, res) => {
    db.query("SELECT id, event_name, max_team_size FROM events", (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch config" });
        res.json(rows);
    });
});

app.post("/admin/update-limit", (req, res) => {
    const { eventId, newLimit } = req.body;
    db.query("UPDATE events SET max_team_size = ? WHERE id = ?", [newLimit, eventId], (err) => {
        if (err) return res.status(500).json({ success: false, message: "Update failed" });
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

app.delete("/admin/delete-event", (req, res) => {
    const eventName = req.query.name;
    db.query("DELETE FROM events WHERE event_name = ?", [eventName], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});
app.get("/admin/grouped-teams", (req, res) => {
    // 1. Extract the new parameters from the request
    const { eventName, college, token } = req.query;

    // 2. Base Query
    let sqlQuery = `
        SELECT se.team_token, s.name, s.reg_no, s.department, s.college 
        FROM student_events se 
        JOIN students s ON se.student_id = s.id 
        JOIN events e ON se.event_id = e.id 
        WHERE e.event_name = ? 
        AND se.team_token IS NOT NULL 
        AND se.team_token != ''`;

    const queryParams = [eventName];

    // 3. Dynamic Filter: College (Partial match using LIKE)
    if (college && college.trim() !== "") {
        sqlQuery += " AND s.college LIKE ?";
        queryParams.push(`%${college}%`);
    }

    // 4. Dynamic Filter: Team Token (Exact match)
    if (token && token.trim() !== "") {
        sqlQuery += " AND se.team_token = ?";
        queryParams.push(token.trim());
    }

    // 5. Final Order
    sqlQuery += " ORDER BY se.team_token ASC";

    db.query(sqlQuery, queryParams, (err, rows) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Grouping failed" });
        }

        // 6. Structure the data for the frontend
        const grouped = rows.reduce((acc, row) => {
            (acc[row.team_token] = acc[row.team_token] || []).push(row);
            return acc;
        }, {});

        res.json(grouped);
    });
});
app.get("/api/settings", (req, res) => res.json(globalSettings));

// POST update settings (Used by your Admin Panel)
app.post("/api/settings", (req, res) => {
    if (req.body.limit) globalSettings.event_selection_limit = parseInt(req.body.limit);
    if (req.body.deadline) globalSettings.registration_deadline = req.body.deadline;
    
    console.log("📢 Settings Updated:", globalSettings);
    res.json({ success: true, settings: globalSettings });
});

/* ---------- GLOBAL PROTECTORS ---------- */
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ UNHANDLED REJECTION CAUGHT: Server staying alive.', reason);
});

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION CAUGHT: Server staying alive.', err);
});
app.get("/validate-token", (req, res) => {
    const { eventId, token } = req.query;

    if (!eventId || !token) return res.status(400).json({ error: "Missing data" });

    // 1. Get the max limit for this event
    db.query("SELECT max_team_size, event_name FROM events WHERE id = ?", [eventId], (err, eventResults) => {
        if (err || eventResults.length === 0) return res.status(404).json({ error: "Event not found" });

        const maxLimit = eventResults[0].max_team_size;
        const eventName = eventResults[0].event_name;

        // 2. Count how many people already used this token for this event
        const countQuery = "SELECT COUNT(*) as currentCount FROM student_events WHERE team_token = ? AND event_id = ?";
        db.query(countQuery, [token.trim(), eventId], (err, countResult) => {
            if (err) return res.status(500).json({ error: "DB Error" });

            const currentMembers = countResult[0].currentCount;

            // --- UPDATED LOGIC HERE ---
            if (currentMembers === 0) {
                // We no longer allow "new" status for typed tokens. 
                // Typed tokens MUST match an existing team.
                res.json({ 
                    status: "invalid", 
                    message: `❌ This code does not exist. Leave it blank to be a Leader.` 
                });
            } else if (currentMembers < maxLimit) {
                res.json({ 
                    status: "join", 
                    message: `✅ Team found! (${currentMembers}/${maxLimit} members). You can join.` 
                });
            } else {
                res.json({ 
                    status: "full", 
                    message: `❌ This team is already full (${maxLimit}/${maxLimit})` 
                });
            }
        });
    });
});
/* ---------- ADMIN: EVENT PARTICIPATION COUNT (For Chart) ---------- */
app.get("/admin/event-count", (req, res) => {
    const query = `
        SELECT e.event_name, COUNT(se.student_id) as participants 
        FROM events e
        LEFT JOIN student_events se ON e.id = se.event_id
        GROUP BY e.id
    `;
    db.query(query, (err, rows) => {
        if (err) return res.status(500).json({ error: "Chart data failed" });
        res.json(rows);
    });
});

/* ---------- ADMIN LOGIN: SECURE ACCESS ---------- */
app.post("/admin/login", (req, res) => {
    const { username, password } = req.body;

    // These values are pulled directly from your .env file
    const masterUser = process.env.ADMIN_USER;
    const masterPass = process.env.ADMIN_PASS;

    if (username === masterUser && password === masterPass) {
        console.log(`🔐 Admin Access Granted to: ${username}`);
        res.json({ 
            success: true, 
            message: "Authentication successful",
            redirect: "admin.html" 
        });
    } else {
        console.log(`🚫 Failed Admin Login attempt as: ${username}`);
        res.status(401).json({ 
            success: false, 
            message: "Invalid Admin Credentials" 
        });
    }
});

/* ---------- SERVER START ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});