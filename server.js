import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error("ERROR: JWT_SECRET environment variable is required");
  process.exit(1);
}

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection on startup
pool.connect()
  .then(client => {
    console.log("Database connected successfully");
    client.release();
  })
  .catch(err => {
    console.error("Database connection failed:", err.message);
    console.log("Note: Make sure your database is running and DATABASE_URL is correct");
    if (process.env.NODE_ENV !== 'development') {
      process.exit(1);
    }
  });

const app = express();

// Security middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : true,
  credentials: true
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// JWT middleware
function auth(requiredRole = null) {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: "No authorization header provided" });
      }
      
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }
      
      jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
          return res.status(403).json({ message: "Invalid or expired token" });
        }
        if (requiredRole && user.role !== requiredRole) {
          return res.status(403).json({ message: "Insufficient permissions" });
        }
        req.user = user;
        next();
      });
    } catch (error) {
      console.error("Auth middleware error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };
}

// --- AUTH ---
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) return res.status(401).json({ message: "Invalid user/pass" });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: "Invalid user/pass" });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ token, role: user.role, username: user.username });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Registration endpoint
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    if (password.length < 3) {
      return res.status(400).json({ message: "Password must be at least 3 characters" });
    }
    
    // Check if user already exists
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Username already exists" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user')", [username, hash]);
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// --- STATS ---
app.get("/api/stats", auth(), async (req, res) => {
  try {
    const carsResult = await pool.query("SELECT COUNT(*) FROM cars WHERE is_active = TRUE");
    const driversResult = await pool.query("SELECT COUNT(*) FROM drivers WHERE is_active = TRUE");
    const activeAssignmentsResult = await pool.query("SELECT COUNT(*) FROM assignments WHERE unassigned_at IS NULL");
    
    res.json({
      cars: parseInt(carsResult.rows[0].count),
      drivers: parseInt(driversResult.rows[0].count),
      activeAssignments: parseInt(activeAssignmentsResult.rows[0].count)
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// --- USERS (admin only) ---
app.get("/api/users", auth("admin"), async (req, res) => {
  try {
    const data = await pool.query("SELECT id, username, role, created_at FROM users ORDER BY id");
    res.json(data.rows);
  } catch (error) {
    console.error("Users fetch error:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.post("/api/users", auth("admin"), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ message: "Role must be 'admin' or 'user'" });
    }
    
    // Check if user already exists
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Username already exists" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)", [username, hash, role]);
    res.sendStatus(201);
  } catch (error) {
    console.error("User creation error:", error);
    res.status(500).json({ message: "Failed to create user" });
  }
});

app.delete("/api/users/:id", auth("admin"), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const result = await pool.query("DELETE FROM users WHERE id = $1 AND role != 'admin'", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found or cannot delete admin user" });
    }
    res.sendStatus(204);
  } catch (error) {
    console.error("User deletion error:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// --- CARS ---
app.get("/api/cars", auth(), async (req, res) => {
  try {
    const data = await pool.query(`
      SELECT c.*, 
             CASE WHEN c.is_active THEN 'Active' ELSE 'Inactive' END as status,
             d.name as driver_name
      FROM cars c
      LEFT JOIN assignments a ON c.id = a.car_id AND a.unassigned_at IS NULL
      LEFT JOIN drivers d ON a.driver_id = d.id
      WHERE c.is_active = TRUE 
      ORDER BY c.id
    `);
    res.json(data.rows);
  } catch (error) {
    console.error("Cars fetch error:", error);
    res.status(500).json({ message: "Failed to fetch cars" });
  }
});

app.post("/api/cars", auth("admin"), async (req, res) => {
  try {
    const { license_plate, model } = req.body;
    if (!license_plate || !model) {
      return res.status(400).json({ message: "License plate and model are required" });
    }
    await pool.query("INSERT INTO cars (license_plate, model) VALUES ($1, $2)", [license_plate, model]);
    res.sendStatus(201);
  } catch (error) {
    console.error("Car creation error:", error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ message: "License plate already exists" });
    } else {
      res.status(500).json({ message: "Failed to create car" });
    }
  }
});

app.delete("/api/cars/:id", auth("admin"), async (req, res) => {
  try {
    await pool.query("UPDATE cars SET is_active = FALSE WHERE id = $1", [req.params.id]);
    res.sendStatus(204);
  } catch (error) {
    console.error("Car deletion error:", error);
    res.status(500).json({ message: "Failed to delete car" });
  }
});

// --- DRIVERS ---
app.get("/api/drivers", auth(), async (req, res) => {
  try {
    const data = await pool.query(`
      SELECT d.*, 
             d.phone as contact,
             c.license_plate as car_plate
      FROM drivers d
      LEFT JOIN assignments a ON d.id = a.driver_id AND a.unassigned_at IS NULL
      LEFT JOIN cars c ON a.car_id = c.id
      WHERE d.is_active = TRUE 
      ORDER BY d.id
    `);
    res.json(data.rows);
  } catch (error) {
    console.error("Drivers fetch error:", error);
    res.status(500).json({ message: "Failed to fetch drivers" });
  }
});

app.post("/api/drivers", auth("admin"), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    await pool.query("INSERT INTO drivers (name, phone) VALUES ($1, $2)", [name, phone || null]);
    res.sendStatus(201);
  } catch (error) {
    console.error("Driver creation error:", error);
    res.status(500).json({ message: "Failed to create driver" });
  }
});

app.delete("/api/drivers/:id", auth("admin"), async (req, res) => {
  try {
    await pool.query("UPDATE drivers SET is_active = FALSE WHERE id = $1", [req.params.id]);
    res.sendStatus(204);
  } catch (error) {
    console.error("Driver deletion error:", error);
    res.status(500).json({ message: "Failed to delete driver" });
  }
});

// --- ASSIGNMENTS (history) ---
app.get("/api/assignments", auth(), async (req, res) => {
  try {
    const data = await pool.query(
      `SELECT a.*, 
              c.license_plate, 
              d.name as driver_name, 
              d.name,
              a.assigned_at as start_time,
              a.unassigned_at as end_time,
              a.car_id,
              a.driver_id,
              u.username as assigned_by_name, 
              u2.username as unassigned_by_name
       FROM assignments a 
       LEFT JOIN cars c ON a.car_id = c.id
       LEFT JOIN drivers d ON a.driver_id = d.id
       LEFT JOIN users u ON a.assigned_by = u.id
       LEFT JOIN users u2 ON a.unassigned_by = u2.id
       ORDER BY a.id DESC`
    );
    res.json(data.rows);
  } catch (error) {
    console.error("Assignments fetch error:", error);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});

// Assign car to driver
app.post("/api/assignments", auth(), async (req, res) => {
  try {
    const { car_id, driver_id, assigned_at, start_time } = req.body;
    const assignedTime = assigned_at || start_time || new Date();
    
    if (!car_id || !driver_id) {
      return res.status(400).json({ message: "Car ID and driver ID are required" });
    }

    // End previous assignment for this car (if any)
    await pool.query(
      "UPDATE assignments SET unassigned_at = NOW(), unassigned_by = $1 WHERE car_id = $2 AND unassigned_at IS NULL",
      [req.user.id, car_id]
    );
    
    // End previous assignment for this driver (if any)
    await pool.query(
      "UPDATE assignments SET unassigned_at = NOW(), unassigned_by = $1 WHERE driver_id = $2 AND unassigned_at IS NULL",
      [req.user.id, driver_id]
    );
    
    // New assignment
    await pool.query(
      "INSERT INTO assignments (car_id, driver_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)",
      [car_id, driver_id, req.user.id, assignedTime]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Assignment creation error:", error);
    res.status(500).json({ message: "Failed to create assignment" });
  }
});

// Unassign car (set end date)
app.post("/api/assignments/unassign", auth(), async (req, res) => {
  try {
    const { car_id, unassigned_at } = req.body;
    if (!car_id) {
      return res.status(400).json({ message: "Car ID is required" });
    }
    await pool.query(
      "UPDATE assignments SET unassigned_at = $1, unassigned_by = $2 WHERE car_id = $3 AND unassigned_at IS NULL",
      [unassigned_at || new Date(), req.user.id, car_id]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Assignment unassignment error:", error);
    res.status(500).json({ message: "Failed to unassign car" });
  }
});

// End assignment by ID (for frontend compatibility)
app.put("/api/assignments/:id", auth(), async (req, res) => {
  try {
    const { end_time } = req.body;
    await pool.query(
      "UPDATE assignments SET unassigned_at = $1, unassigned_by = $2 WHERE id = $3",
      [end_time || new Date(), req.user.id, req.params.id]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Assignment end error:", error);
    res.status(500).json({ message: "Failed to end assignment" });
  }
});

// Fallback for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 FleetMan server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});