const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root123", // change this
    database: "symposium_db"
});

db.connect(err => {
    if (err) {
        console.error("MySQL connection failed:", err);
    } else {
        console.log("MySQL connected to symposium_db");
    }
});

module.exports = db;
