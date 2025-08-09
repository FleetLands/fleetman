import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : true,
  credentials: true
}));

// Input validation helpers
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePhoneNumber(phone) {
  // Basic phone validation - allows digits, spaces, dashes, parentheses, and plus sign
  const re = /^[\+]?[\d\s\-\(\)]+$/;
  return phone ? re.test(phone) : true; // Optional field
}

function validateLicensePlate(plate) {
  // Basic license plate validation - alphanumeric with optional dashes and spaces
  const re = /^[A-Za-z0-9\s\-]+$/;
  return re.test(plate);
}

// Request validation middleware
function validateRequest(schema) {
  return (req, res, next) => {
    try {
      for (const [field, validator] of Object.entries(schema)) {
        const value = req.body[field];
        
        if (validator.required && (!value || value.toString().trim() === '')) {
          return res.status(400).json({ message: `${field} is required` });
        }
        
        if (value && validator.type) {
          if (validator.type === 'string' && typeof value !== 'string') {
            return res.status(400).json({ message: `${field} must be a string` });
          }
          if (validator.type === 'number' && isNaN(Number(value))) {
            return res.status(400).json({ message: `${field} must be a number` });
          }
        }
        
        if (value && validator.minLength && value.toString().length < validator.minLength) {
          return res.status(400).json({ message: `${field} must be at least ${validator.minLength} characters` });
        }
        
        if (value && validator.maxLength && value.toString().length > validator.maxLength) {
          return res.status(400).json({ message: `${field} must be no more than ${validator.maxLength} characters` });
        }
        
        if (value && validator.pattern && !validator.pattern.test(value)) {
          return res.status(400).json({ message: validator.message || `${field} format is invalid` });
        }
        
        if (value && validator.custom && !validator.custom(value)) {
          return res.status(400).json({ message: validator.message || `${field} is invalid` });
        }
      }
      next();
    } catch (error) {
      console.error("Validation error:", error);
      res.status(500).json({ message: "Validation failed" });
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { message: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all API routes
app.use('/api', generalLimiter);

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
app.post("/api/auth/login", authLimiter, validateRequest({
  username: { required: true, type: 'string', minLength: 1, maxLength: 50 },
  password: { required: true, type: 'string', minLength: 1 }
}), async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username.trim()]);
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
app.post("/api/auth/register", authLimiter, validateRequest({
  username: { 
    required: true, 
    type: 'string', 
    minLength: 3, 
    maxLength: 50,
    pattern: /^[a-zA-Z0-9_]+$/,
    message: "Username can only contain letters, numbers, and underscores"
  },
  password: { required: true, type: 'string', minLength: 3, maxLength: 100 }
}), async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check if user already exists
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Username already exists" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user')", [username.trim(), hash]);
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

app.post("/api/users", auth("admin"), validateRequest({
  username: { 
    required: true, 
    type: 'string', 
    minLength: 3, 
    maxLength: 50,
    pattern: /^[a-zA-Z0-9_]+$/,
    message: "Username can only contain letters, numbers, and underscores"
  },
  password: { required: true, type: 'string', minLength: 3, maxLength: 100 },
  role: { 
    required: true, 
    type: 'string',
    custom: (value) => ['admin', 'user'].includes(value),
    message: "Role must be 'admin' or 'user'"
  }
}), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // Check if user already exists
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Username already exists" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)", [username.trim(), hash, role]);
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

app.post("/api/cars", auth("admin"), validateRequest({
  license_plate: { 
    required: true, 
    type: 'string', 
    minLength: 1, 
    maxLength: 20,
    custom: validateLicensePlate,
    message: "License plate can only contain letters, numbers, spaces, and dashes"
  },
  model: { required: true, type: 'string', minLength: 1, maxLength: 50 }
}), async (req, res) => {
  try {
    const { license_plate, model } = req.body;
    await pool.query("INSERT INTO cars (license_plate, model) VALUES ($1, $2)", [license_plate.trim().toUpperCase(), model.trim()]);
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

app.post("/api/drivers", auth("admin"), validateRequest({
  name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
  phone: { 
    required: false, 
    type: 'string', 
    maxLength: 20,
    custom: validatePhoneNumber,
    message: "Phone number format is invalid"
  }
}), async (req, res) => {
  try {
    const { name, phone } = req.body;
    await pool.query("INSERT INTO drivers (name, phone) VALUES ($1, $2)", [name.trim(), phone?.trim() || null]);
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
app.post("/api/assignments", auth(), validateRequest({
  car_id: { required: true, type: 'number' },
  driver_id: { required: true, type: 'number' },
  assigned_at: { required: false, type: 'string' },
  start_time: { required: false, type: 'string' }
}), async (req, res) => {
  try {
    const { car_id, driver_id, assigned_at, start_time } = req.body;
    const assignedTime = assigned_at || start_time || new Date();

    // Verify car and driver exist and are active
    const carCheck = await pool.query("SELECT id FROM cars WHERE id = $1 AND is_active = TRUE", [car_id]);
    if (carCheck.rows.length === 0) {
      return res.status(404).json({ message: "Car not found or inactive" });
    }
    
    const driverCheck = await pool.query("SELECT id FROM drivers WHERE id = $1 AND is_active = TRUE", [driver_id]);
    if (driverCheck.rows.length === 0) {
      return res.status(404).json({ message: "Driver not found or inactive" });
    }

    // Begin transaction
    await pool.query('BEGIN');
    
    try {
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
      
      await pool.query('COMMIT');
      res.sendStatus(201);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
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