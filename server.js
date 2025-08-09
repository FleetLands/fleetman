const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = process.env.JWT_SECRET || 'devsecret';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- AUTH ---
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const q = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = q.rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: "1d" });
  res.json({ token, role: user.role, username: user.username });
});

function auth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");
    try {
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
      if (role && req.user.role !== role) return res.sendStatus(403);
      next();
    } catch {
      res.sendStatus(401);
    }
  };
}

// --- USERS ADMIN ---
app.get("/api/users", auth("admin"), async (req, res) => {
  const data = await pool.query("SELECT id, username, role, created_at FROM users ORDER BY id");
  res.json(data.rows);
});

app.post("/api/users", auth("admin"), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: "All fields required" });
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES ($1, $2, $3, NOW())",
      [username, hash, role]
    );
    res.status(201).json({});
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Username already exists" });
    throw e;
  }
});

app.delete("/api/users/:id", auth("admin"), async (req, res) => {
  // Prevent admin deleting themselves
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }
  await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.status(200).json({});
});

// --- CARS ---
app.get("/api/cars", auth(), async (req, res) => {
  const search = req.query.q?.trim() || "";
  let data;
  if (search) {
    data = await pool.query(
      "SELECT * FROM cars WHERE is_active = TRUE AND (license_plate ILIKE $1 OR model ILIKE $1) ORDER BY id",
      [`%${search}%`]
    );
  } else {
    data = await pool.query("SELECT * FROM cars WHERE is_active = TRUE ORDER BY id");
  }
  res.json(data.rows);
});
app.post("/api/cars", auth("admin"), async (req, res) => {
  const { license_plate, model } = req.body;
  await pool.query(
    "INSERT INTO cars (license_plate, model, is_active, created_at) VALUES ($1, $2, TRUE, NOW())",
    [license_plate, model]
  );
  res.status(201).json({});
});
app.delete("/api/cars/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE cars SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.status(200).json({});
});

// --- DRIVERS ---
app.get("/api/drivers", auth(), async (req, res) => {
  const search = req.query.q?.trim() || "";
  let data;
  if (search) {
    data = await pool.query(
      "SELECT * FROM drivers WHERE is_active = TRUE AND (name ILIKE $1 OR contact_no ILIKE $1) ORDER BY id",
      [`%${search}%`]
    );
  } else {
    data = await pool.query("SELECT * FROM drivers WHERE is_active = TRUE ORDER BY id");
  }
  res.json(data.rows);
});
app.post("/api/drivers", auth("admin"), async (req, res) => {
  const { name, contact_no } = req.body;
  await pool.query(
    "INSERT INTO drivers (name, contact_no, is_active, created_at) VALUES ($1, $2, TRUE, NOW())",
    [name, contact_no]
  );
  res.status(201).json({});
});
app.delete("/api/drivers/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE drivers SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.status(200).json({});
});

// --- STATS ---
app.get("/api/stats", auth(), async (req, res) => {
  const cars = await pool.query("SELECT COUNT(*) FROM cars WHERE is_active = TRUE");
  const drivers = await pool.query("SELECT COUNT(*) FROM drivers WHERE is_active = TRUE");
  const assignments = await pool.query(
    "SELECT COUNT(*) FROM assignments WHERE unassigned_at IS NULL"
  );
  res.json({
    cars: parseInt(cars.rows[0].count),
    drivers: parseInt(drivers.rows[0].count),
    activeAssignments: parseInt(assignments.rows[0].count),
  });
});

// --- ASSIGNMENTS ---
// Now ALL authenticated users (not just admins) can assign/unassign

app.get("/api/assignments", auth(), async (req, res) => {
  const data = await pool.query(`
    SELECT a.*, c.license_plate, d.name AS driver_name
    FROM assignments a
    LEFT JOIN cars c ON a.car_id = c.id
    LEFT JOIN drivers d ON a.driver_id = d.id
    WHERE a.unassigned_at IS NULL
    ORDER BY a.assigned_at DESC
  `);
  res.json(data.rows);
});

app.post("/api/assignments", auth(), async (req, res) => {
  const { car_id, driver_id, assigned_at } = req.body;
  // Unassign any active assignment for this car or driver before assigning
  await pool.query("UPDATE assignments SET unassigned_at = NOW(), unassigned_by = $1 WHERE (car_id = $2 OR driver_id = $3) AND unassigned_at IS NULL", [req.user.id, car_id, driver_id]);
  await pool.query(
    "INSERT INTO assignments (car_id, driver_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)",
    [car_id, driver_id, req.user.id, assigned_at || new Date()]
  );
  res.status(201).json({});
});

app.patch("/api/assignments/:id/unassign", auth(), async (req, res) => {
  await pool.query("UPDATE assignments SET unassigned_at = NOW(), unassigned_by = $1 WHERE id = $2 AND unassigned_at IS NULL", [req.user.id, req.params.id]);
  res.status(200).json({});
});

// --- HISTORY ENDPOINTS ---
app.get("/api/assignments/history/car/:car_id", auth(), async (req, res) => {
  const data = await pool.query(`
    SELECT a.*, d.name AS driver_name
    FROM assignments a
    LEFT JOIN drivers d ON a.driver_id = d.id
    WHERE a.car_id = $1
    ORDER BY a.assigned_at DESC
  `, [req.params.car_id]);
  res.json(data.rows);
});

app.get("/api/assignments/history/driver/:driver_id", auth(), async (req, res) => {
  const data = await pool.query(`
    SELECT a.*, c.license_plate
    FROM assignments a
    LEFT JOIN cars c ON a.car_id = c.id
    WHERE a.driver_id = $1
    ORDER BY a.assigned_at DESC
  `, [req.params.driver_id]);
  res.json(data.rows);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
