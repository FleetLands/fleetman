const $ = (sel) => document.querySelector(sel);
let token = localStorage.getItem("token") || "";
let role = localStorage.getItem("role") || "";
let username = localStorage.getItem("username") || "";

// --- API Helper ---
async function api(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = "Unknown error";
    try {
      const err = await res.json();
      msg = err.error || msg;
    } catch {}
    throw new Error(msg);
  }
  // Only parse JSON if there is content
  if (res.status === 204) return;
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

// --- Auth / UI Routing ---
function showPage(page) {
  ["loginPage", "dashboardSection", "carsSection", "driversSection", "assignmentsSection"].forEach(id => {
    const sec = document.getElementById(id);
    if (sec) sec.style.display = (id === page) ? "block" : "none";
  });
  document.querySelectorAll("nav button").forEach(btn => btn.classList.remove("active"));
  if (page === "dashboardSection") $("#dashboardBtn").classList.add("active");
  if (page === "carsSection") $("#carsBtn").classList.add("active");
  if (page === "driversSection") $("#driversBtn").classList.add("active");
  if (page === "assignmentsSection") $("#assignmentsBtn").classList.add("active");
}

function logout() {
  token = "";
  role = "";
  username = "";
  localStorage.clear();
  showLogin();
}

// --- Login ---
function showLogin(msg = "") {
  showPage("loginPage");
  $("#loginMsg").textContent = msg;
  $("#loginMsg").classList.toggle("d-none", !msg);
  $("#loginForm").onsubmit = async e => {
    e.preventDefault();
    $("#loginBtn").disabled = true;
    try {
      const data = await api("/api/login", "POST", {
        username: $("#loginUser").value.trim(),
        password: $("#loginPass").value
      });
      token = data.token;
      role = data.role;
      username = data.username;
      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      localStorage.setItem("username", username);
      showDashboard();
    } catch (err) {
      $("#loginMsg").textContent = err.message || "Login failed";
      $("#loginMsg").classList.remove("d-none");
    }
    $("#loginBtn").disabled = false;
  };
}

function requireAuth() {
  if (!token) {
    showLogin();
    return false;
  }
  return true;
}

// --- Dashboard ---
async function showDashboard() {
  if (!requireAuth()) return;
  showPage("dashboardSection");
  $("#welcomeUser").textContent = username ? `Welcome, ${username}!` : "";
  try {
    const stats = await api("/api/stats");
    $("#totalCars").textContent = stats.cars || 0;
    $("#totalDrivers").textContent = stats.drivers || 0;
    $("#activeAssignments").textContent = stats.activeAssignments || 0;
  } catch {
    $("#totalCars").textContent = "0";
    $("#totalDrivers").textContent = "0";
    $("#activeAssignments").textContent = "0";
  }
}

// --- Cars ---
async function showCars() {
  if (!requireAuth()) return;
  showPage("carsSection");
  await loadCars();
}
async function loadCars() {
  const carsTable = $("#carsTable");
  try {
    const cars = await api("/api/cars");
    carsTable.innerHTML = cars.map(c =>
      `<tr>
        <td>${c.license_plate}</td>
        <td>${c.model}</td>
        <td>${new Date(c.created_at).toLocaleDateString()}</td>
        <td>
          ${role === "admin" ? `<button class="btn btn-danger btn-sm me-1" onclick="deleteCar(${c.id})">Delete</button>` : ""}
          <button class="btn btn-secondary btn-sm" onclick="showCarHistory(${c.id},'${c.license_plate}')">History</button>
        </td>
      </tr>`
    ).join("");
  } catch {
    carsTable.innerHTML = `<tr><td colspan="4">Failed to load cars</td></tr>`;
  }
}
window.deleteCar = async id => {
  if (!confirm("Delete car?")) return;
  try {
    await api("/api/cars/" + id, "DELETE");
    await loadCars();
    await showDashboard();
  } catch (e) {
    alert(e.message || "Failed to delete car");
  }
};
$("#carForm") && ($("#carForm").onsubmit = async e => {
  e.preventDefault();
  if (role !== "admin") return;
  try {
    await api("/api/cars", "POST", {
      license_plate: $("#carLicense").value,
      model: $("#carModel").value
    });
    e.target.reset();
    await loadCars();
    await showDashboard();
  } catch (err) {
    alert(err.message || "Failed to add car");
  }
});
window.showCarHistory = async (car_id, license_plate) => {
  $("#historyModalLabel").textContent = `History for Car: ${license_plate}`;
  $("#historyModalBody").innerHTML = `<div class="text-center my-3">Loading...</div>`;
  const data = await api(`/api/assignments/history/car/${car_id}`);
  if (data.length === 0) {
    $("#historyModalBody").innerHTML = `<div class="text-center text-muted">No assignment history for this car.</div>`;
  } else {
    $("#historyModalBody").innerHTML = `
      <table class="table table-sm">
        <thead><tr><th>Driver</th><th>Assigned At</th><th>Unassigned At</th></tr></thead>
        <tbody>
          ${data.map(a => `<tr>
            <td>${a.driver_name || '-'}</td>
            <td>${a.assigned_at ? new Date(a.assigned_at).toLocaleString() : '-'}</td>
            <td>${a.unassigned_at ? new Date(a.unassigned_at).toLocaleString() : '-'}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    `;
  }
  const modal = new bootstrap.Modal($("#historyModal"));
  modal.show();
};

// --- Drivers ---
async function showDrivers() {
  if (!requireAuth()) return;
  showPage("driversSection");
  await loadDrivers();
}
async function loadDrivers() {
  const driversTable = $("#driversTable");
  try {
    const drivers = await api("/api/drivers");
    driversTable.innerHTML = drivers.map(dr =>
      `<tr>
        <td>${dr.name}</td>
        <td>${new Date(dr.created_at).toLocaleDateString()}</td>
        <td>
          ${role === "admin" ? `<button class="btn btn-danger btn-sm me-1" onclick="deleteDriver(${dr.id})">Delete</button>` : ""}
          <button class="btn btn-secondary btn-sm" onclick="showDriverHistory(${dr.id},'${dr.name}')">History</button>
        </td>
      </tr>`
    ).join("");
  } catch {
    driversTable.innerHTML = `<tr><td colspan="3">Failed to load drivers</td></tr>`;
  }
}
window.deleteDriver = async id => {
  if (!confirm("Delete driver?")) return;
  try {
    await api("/api/drivers/" + id, "DELETE");
    await loadDrivers();
    await showDashboard();
  } catch (e) {
    alert(e.message || "Failed to delete driver");
  }
};
$("#driverForm") && ($("#driverForm").onsubmit = async e => {
  e.preventDefault();
  if (role !== "admin") return;
  try {
    await api("/api/drivers", "POST", {
      name: $("#driverName").value
    });
    e.target.reset();
    await loadDrivers();
    await showDashboard();
  } catch (err) {
    alert(err.message || "Failed to add driver");
  }
});
window.showDriverHistory = async (driver_id, driver_name) => {
  $("#historyModalLabel").textContent = `History for Driver: ${driver_name}`;
  $("#historyModalBody").innerHTML = `<div class="text-center my-3">Loading...</div>`;
  const data = await api(`/api/assignments/history/driver/${driver_id}`);
  if (data.length === 0) {
    $("#historyModalBody").innerHTML = `<div class="text-center text-muted">No assignment history for this driver.</div>`;
  } else {
    $("#historyModalBody").innerHTML = `
      <table class="table table-sm">
        <thead><tr><th>Car</th><th>Assigned At</th><th>Unassigned At</th></thead>
        <tbody>
          ${data.map(a => `<tr>
            <td>${a.license_plate || '-'}</td>
            <td>${a.assigned_at ? new Date(a.assigned_at).toLocaleString() : '-'}</td>
            <td>${a.unassigned_at ? new Date(a.unassigned_at).toLocaleString() : '-'}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    `;
  }
  const modal = new bootstrap.Modal($("#historyModal"));
  modal.show();
};

// --- Assignments ---
async function showAssignments() {
  if (!requireAuth()) return;
  showPage("assignmentsSection");
  await loadAssignments();
  await loadAssignmentForm();
}
async function loadAssignments() {
  const assignmentsTable = $("#assignmentsTable");
  try {
    const assignments = await api("/api/assignments");
    assignmentsTable.innerHTML = assignments.length ? assignments.map(a =>
      `<tr>
        <td>${a.license_plate || '-'}</td>
        <td>${a.driver_name || '-'}</td>
        <td>${a.assigned_at ? new Date(a.assigned_at).toLocaleString() : '-'}</td>
        <td>
          ${role === "admin" ? `<button class="btn btn-danger btn-sm" onclick="unassignAssignment(${a.id})">Unassign</button>` : ""}
        </td>
      </tr>`
    ).join("") : `<tr><td colspan="4" class="text-center text-muted">No current assignments</td></tr>`;
  } catch {
    assignmentsTable.innerHTML = `<tr><td colspan="4">Failed to load assignments</td></tr>`;
  }
}
async function loadAssignmentForm() {
  // Populate cars and drivers selects
  if (role !== "admin") {
    $("#assignmentForm").style.display = "none";
    return;
  }
  $("#assignmentForm").style.display = "";
  const [cars, drivers] = await Promise.all([
    api("/api/cars"), api("/api/drivers")
  ]);
  $("#assignCar").innerHTML = cars.map(c => `<option value="${c.id}">${c.license_plate} (${c.model})</option>`).join("");
  $("#assignDriver").innerHTML = drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
}
$("#assignmentForm") && ($("#assignmentForm").onsubmit = async e => {
  e.preventDefault();
  try {
    const car_id = $("#assignCar").value;
    const driver_id = $("#assignDriver").value;
    const assigned_at = $("#assignDate").value ? (new Date($("#assignDate").value)).toISOString() : undefined;
    await api("/api/assignments", "POST", { car_id, driver_id, assigned_at });
    e.target.reset();
    await loadAssignments();
    await showDashboard();
  } catch (err) {
    alert(err.message || "Failed to assign");
  }
});
window.unassignAssignment = async id => {
  if (!confirm("Unassign this car/driver?")) return;
  try {
    await api(`/api/assignments/${id}/unassign`, "PATCH");
    await loadAssignments();
    await showDashboard();
  } catch (e) {
    alert(e.message || "Failed to unassign");
  }
};

// --- Navigation ---
document.addEventListener("DOMContentLoaded", () => {
  $("#dashboardBtn").onclick = showDashboard;
  $("#carsBtn").onclick = showCars;
  $("#driversBtn").onclick = showDrivers;
  $("#assignmentsBtn").onclick = showAssignments;
  $("#logoutBtn").onclick = logout;
  if (token) showDashboard();
  else showLogin();
});
