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

// --- CARS ---
app.get("/api/cars", auth(), async (req, res) => {
  const data = await pool.query("SELECT * FROM cars WHERE is_active = TRUE ORDER BY id");
  res.json(data.rows);
});
app.post("/api/cars", auth("admin"), async (req, res) => {
  const { license_plate, model } = req.body;
  await pool.query(
    "INSERT INTO cars (license_plate, model, is_active, created_at) VALUES ($1, $2, TRUE, NOW())",
    [license_plate, model]
  );
  res.sendStatus(201);
});
app.delete("/api/cars/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE cars SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.sendStatus(204);
});

// --- DRIVERS ---
app.get("/api/drivers", auth(), async (req, res) => {
  const data = await pool.query("SELECT * FROM drivers WHERE is_active = TRUE ORDER BY id");
  res.json(data.rows);
});
app.post("/api/drivers", auth("admin"), async (req, res) => {
  const { name } = req.body;
  await pool.query(
    "INSERT INTO drivers (name, is_active, created_at) VALUES ($1, TRUE, NOW())",
    [name]
  );
  res.sendStatus(201);
});
app.delete("/api/drivers/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE drivers SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.sendStatus(204);
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));