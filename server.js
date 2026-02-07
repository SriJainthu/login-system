

const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

/* ---------- GLOBAL SETTINGS ---------- */
let globalSettings = {
  event_selection_limit: 3,
  registration_deadline: "2026-03-15T09:00:00"
};

/* ---------- DATABASE ---------- */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    return;
  }
  console.log("✅ MySQL connected");
});

setInterval(() => {
  db.query("SELECT 1");
}, 30000);

/* ---------- DEADLINE CHECK ---------- */
const checkDeadline = (req, res, next) => {
  if (new Date() > new Date(globalSettings.registration_deadline)) {
    return res.status(403).json({
      success: false,
      message: "Registration closed"
    });
  }
  next();
};

/* ---------- EVENTS ---------- */
app.get("/events", (req, res) => {
  db.query("SELECT * FROM events", (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed" });
    res.json(rows);
  });
});

/* ======================================================
   REGISTRATION STEP 1 — SEND OTP (DB BASED)
====================================================== */
app.post("/register/send-otp", checkDeadline, async (req, res) => {
  const { email, reg_no } = req.body;
  if (!email || !reg_no) return res.status(400).json({ message: "Missing fields" });

  db.query(
    "SELECT email, reg_no FROM students WHERE email = ? OR reg_no = ?",
    [email, reg_no],
    async (err, existing) => {
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          message: "Already registered"
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      await db.promise().query(
        `REPLACE INTO otp_verification (identifier, otp, expires_at, purpose)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'register')`,
        [email, otp]
      );

      try {
        await resend.emails.send({
          from: "Symposium 2026 <onboarding@resend.dev>",
          to: email,
          subject: `Your OTP: ${otp}`,
          html: `<h2>${otp}</h2>`
        });

        res.json({ success: true, message: "OTP sent" });
      } catch (e) {
        res.status(500).json({ message: "Email failed" });
      }
    }
  );
});

/* ======================================================
   REGISTRATION STEP 2 — VERIFY OTP
====================================================== */
app.post("/register/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const [rows] = await db.promise().query(
    `SELECT * FROM otp_verification
     WHERE identifier=? AND otp=? AND purpose='register'
     AND expires_at > NOW()`,
    [email, otp]
  );

  if (!rows.length)
    return res.status(400).json({ message: "Invalid or expired OTP" });

  await db.promise().query(
    "DELETE FROM otp_verification WHERE identifier=? AND purpose='register'",
    [email]
  );

  res.json({ success: true });
});

/* ======================================================
   REGISTRATION STEP 3 — FINAL SUBMISSION (UNCHANGED)
====================================================== */
app.post("/register", async (req, res) => {
  const { name, reg_no, college, department, year, email, phone, events } = req.body;

  if (!name || !reg_no || !email || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  db.beginTransaction(err => {
    if (err) return res.status(500).json({ message: "Transaction error" });

    db.query(
      "INSERT INTO students (name, reg_no, college, department, year, email, phone) VALUES (?,?,?,?,?,?,?)",
      [name, reg_no, college, department, year, email, phone],
      (err, result) => {
        if (err) {
          return db.rollback(() =>
            res.status(409).json({ message: "Student already registered" })
          );
        }

        const studentId = result.insertId;

        const eventNames = events.map(e => e.name);
        db.query(
          "SELECT id, event_name FROM events WHERE event_name IN (?)",
          [eventNames],
          (err, rows) => {
            if (err) return db.rollback(() => res.status(500).json({ message: "Event error" }));

            const values = rows.map(r => {
              const ev = events.find(e => e.name === r.event_name);
              return [studentId, r.id, ev.token || null];
            });

            db.query(
              "INSERT INTO student_events (student_id,event_id,team_token) VALUES ?",
              [values],
              err => {
                if (err) return db.rollback(() => res.status(500).json({ message: "Mapping failed" }));

                db.commit(async err => {
                  if (err) return db.rollback(() => res.status(500).json({ message: "Commit failed" }));

                  try {
                    await resend.emails.send({
                      from: "Symposium 2026 <onboarding@resend.dev>",
                      to: email,
                      subject: "Registration Successful",
                      html: `<h2>Registration Confirmed</h2>`
                    });
                  } catch (e) {
                    console.error("Email failed");
                  }

                  res.json({
                    success: true,
                    redirect: "/registration-success.html"
                  });
                });
              }
            );
          }
        );
      }
    );
  });
});

/* ======================================================
   VIEW REGISTRATION — SEND OTP (DB BASED)
====================================================== */
app.post("/send-otp", async (req, res) => {
  const { reg_no } = req.body;

  db.query("SELECT email FROM students WHERE reg_no=?", [reg_no], async (err, rows) => {
    if (!rows.length) return res.status(404).json({ message: "Not found" });

    const email = rows[0].email;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await db.promise().query(
      `REPLACE INTO otp_verification (identifier, otp, expires_at, purpose)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'view')`,
      [reg_no, otp]
    );

    try {
      await resend.emails.send({
        from: "Symposium Access <onboarding@resend.dev>",
        to: email,
        subject: "Your Access OTP",
        html: `<h2>${otp}</h2>`
      });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: "Email failed" });
    }
  });
});

/* ======================================================
   VIEW REGISTRATION — VERIFY OTP
====================================================== */
app.post("/verify-otp", async (req, res) => {
  const { reg_no, otp } = req.body;

  const [rows] = await db.promise().query(
    `SELECT * FROM otp_verification
     WHERE identifier=? AND otp=? AND purpose='view'
     AND expires_at > NOW()`,
    [reg_no, otp]
  );

  if (!rows.length) return res.status(400).json({ message: "Invalid OTP" });

  await db.promise().query(
    "DELETE FROM otp_verification WHERE identifier=? AND purpose='view'",
    [reg_no]
  );

  res.json({ success: true });
});

/* ======================================================
   VIEW REGISTRATION — FETCH DETAILS
====================================================== */
app.get("/registration/:reg_no", (req, res) => {
  const reg_no = req.params.reg_no;

  db.query("SELECT * FROM students WHERE reg_no=?", [reg_no], (err, students) => {
    if (!students.length) return res.status(404).json({ message: "Not found" });

    const student = students[0];

    db.query(
      `SELECT e.event_name,se.team_token
       FROM student_events se
       JOIN events e ON se.event_id=e.id
       WHERE se.student_id=?`,
      [student.id],
      (err, events) => {
        res.json({ student, events });
      }
    );
  });
});

/* ======================================================
   ADMIN + SETTINGS (UNCHANGED)
====================================================== */
app.get("/api/settings", (req, res) => res.json(globalSettings));

app.post("/api/settings", (req, res) => {
  if (req.body.limit) globalSettings.event_selection_limit = parseInt(req.body.limit);
  if (req.body.deadline) globalSettings.registration_deadline = req.body.deadline;
  res.json({ success: true });
});

/* ======================================================
   SERVER START
====================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
