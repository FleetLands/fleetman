import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const app = express();

app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

// JWT middleware
function auth(requiredRole = null) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.sendStatus(401);
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      if (requiredRole && user.role !== requiredRole) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };
}

// --- AUTH ---
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (result.rows.length === 0) return res.status(401).json({ message: "Invalid user/pass" });
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ message: "Invalid user/pass" });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.json({ token, role: user.role, username: user.username });
});

// --- USERS (admin only) ---
app.get("/api/users", auth("admin"), async (req, res) => {
  const data = await pool.query("SELECT id, username, role FROM users ORDER BY id");
  res.json(data.rows);
});
app.post("/api/users", auth("admin"), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ message: "All fields required" });
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)", [username, hash, role]);
  res.sendStatus(201);
});
app.delete("/api/users/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM users WHERE id = $1 AND role != 'admin'", [req.params.id]);
  res.sendStatus(204);
});

// --- CARS ---
app.get("/api/cars", auth(), async (req, res) => {
  const data = await pool.query("SELECT * FROM cars WHERE is_active = TRUE ORDER BY id");
  res.json(data.rows);
});
app.post("/api/cars", auth("admin"), async (req, res) => {
  const { license_plate, model } = req.body;
  await pool.query("INSERT INTO cars (license_plate, model) VALUES ($1, $2)", [license_plate, model]);
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
  const { name, phone } = req.body;
  await pool.query("INSERT INTO drivers (name, phone) VALUES ($1, $2)", [name, phone]);
  res.sendStatus(201);
});
app.delete("/api/drivers/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE drivers SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.sendStatus(204);
});

// --- ASSIGNMENTS (history) ---
app.get("/api/assignments", auth(), async (req, res) => {
  const data = await pool.query(
    `SELECT a.*, c.license_plate, d.name as driver_name, u.username as assigned_by_name, u2.username as unassigned_by_name
     FROM assignments a 
     LEFT JOIN cars c ON a.car_id = c.id
     LEFT JOIN drivers d ON a.driver_id = d.id
     LEFT JOIN users u ON a.assigned_by = u.id
     LEFT JOIN users u2 ON a.unassigned_by = u2.id
     ORDER BY a.id DESC`
  );
  res.json(data.rows);
});

// Assign car to driver
app.post("/api/assignments", auth(), async (req, res) => {
  const { car_id, driver_id, assigned_at } = req.body;
  // End previous assignment for this car (if any)
  await pool.query(
    "UPDATE assignments SET unassigned_at = NOW(), unassigned_by = $1 WHERE car_id = $2 AND unassigned_at IS NULL",
    [req.user.id, car_id]
  );
  // New assignment
  await pool.query(
    "INSERT INTO assignments (car_id, driver_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)",
    [car_id, driver_id, req.user.id, assigned_at || new Date()]
  );
  res.sendStatus(201);
});

// Unassign car (set end date)
app.post("/api/assignments/unassign", auth(), async (req, res) => {
  const { car_id, unassigned_at } = req.body;
  await pool.query(
    "UPDATE assignments SET unassigned_at = $1, unassigned_by = $2 WHERE car_id = $3 AND unassigned_at IS NULL",
    [unassigned_at || new Date(), req.user.id, car_id]
  );
  res.sendStatus(200);
});

// Fallback for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));