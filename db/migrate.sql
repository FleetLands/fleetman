-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
);

-- Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  license_no TEXT NOT NULL UNIQUE
);

-- Cars
CREATE TABLE IF NOT EXISTS cars (
  id SERIAL PRIMARY KEY,
  license_plate TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  status TEXT DEFAULT 'active'
);

-- Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  car_id INTEGER REFERENCES cars(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
  assign_time TIMESTAMP NOT NULL
);