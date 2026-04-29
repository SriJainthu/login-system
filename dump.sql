SET SESSION sql_require_primary_key = 0;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table: events
-- ----------------------------
DROP TABLE IF EXISTS events;
CREATE TABLE events (
  id INT NOT NULL AUTO_INCREMENT,
  event_name VARCHAR(100),
  description TEXT,
  event_type ENUM('solo','group') DEFAULT 'solo',
  max_team_size INT DEFAULT 1,
  PRIMARY KEY (id)
);

INSERT INTO events (id, event_name, description, event_type, max_team_size) VALUES
(4,'Quiz',NULL,'solo',1),
(20,'sleep','this is a sleepp event','group',2),
(21,'football','this is a food ball competition','solo',1),
(22,'hackathon','this is the hackathon compeition','group',3);

-- ----------------------------
-- Table: students
-- ----------------------------
DROP TABLE IF EXISTS students;
CREATE TABLE students (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  reg_no VARCHAR(50) NOT NULL UNIQUE,
  college VARCHAR(150) NOT NULL,
  department VARCHAR(100) NOT NULL,
  year VARCHAR(10) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- ----------------------------
-- Table: student_events
-- ----------------------------
DROP TABLE IF EXISTS student_events;
CREATE TABLE student_events (
  student_id INT NOT NULL,
  event_id INT NOT NULL,
  team_token VARCHAR(50),
  UNIQUE KEY unique_student_event (student_id, event_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- ----------------------------
-- Table: otp_verification (FIXED)
-- ----------------------------
DROP TABLE IF EXISTS otp_verification;
CREATE TABLE otp_verification (
  identifier VARCHAR(100) PRIMARY KEY,
  otp VARCHAR(10) NOT NULL,
  expires_at DATETIME NOT NULL,
  purpose VARCHAR(50) NOT NULL
);

SET FOREIGN_KEY_CHECKS = 1;