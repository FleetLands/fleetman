const $ = s => document.querySelector(s);
const api = (url, method = "GET", body = null, token = null) =>
  fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: "Bearer " + token }),
    },
    ...(body && { body: JSON.stringify(body) }),
  }).then(async r => {
    // Try to parse JSON, but support empty responses
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!r.ok) throw data;
    return data;
  });

let token = localStorage.getItem("token");
let role = localStorage.getItem("role");

function renderLogin() {
  $("#app").innerHTML = `
    <div class="card">
      <h2>Login</h2>
      <input id="username" placeholder="Username" />
      <input id="password" placeholder="Password" type="password" />
      <button id="loginBtn">Login</button>
      <div id="loginError" style="color:red;"></div>
    </div>
  `;
  $("#loginBtn").onclick = async () => {
    const username = $("#username").value, password = $("#password").value;
    try {
      const res = await api("/api/auth/login", "POST", { username, password });
      if (res.token) {
        localStorage.setItem("token", res.token);
        localStorage.setItem("role", res.role);
        token = res.token; role = res.role;
        renderApp();
      } else {
        $("#loginError").textContent = res.message || "Login failed";
      }
    } catch (err) {
      $("#loginError").textContent = err.message || "Login failed";
    }
  };
}

function logout() {
  localStorage.clear();
  token = role = null;
  renderLogin();
}

async function renderApp() {
  if (!token) return renderLogin();
  $("#app").innerHTML = `
    <button onclick="logout()" style="float:right">Logout</button>
    <h1>Fleet Management</h1>
    <div id="mainMenu"></div>
    <div id="dashboard"></div>
    <div id="content"></div>
  `;
  const menu = [];
  if (role === "admin") menu.push(`<button data-section="users">Users</button>`);
  menu.push(
    `<button data-section="cars">Cars</button>`,
    `<button data-section="drivers">Drivers</button>`,
    `<button data-section="assignments">Assignments</button>`
  );
  $("#mainMenu").innerHTML = menu.join(" ");
  // Section click events and section memory
  $("#mainMenu").querySelectorAll("button[data-section]").forEach(btn => {
    btn.onclick = () => {
      localStorage.setItem("lastSection", btn.dataset.section);
      showSection(btn.dataset.section);
    };
  });
  // Show last visited section or dashboard
  let last = localStorage.getItem("lastSection") || "dashboard";
  if (last === "dashboard") {
    renderDashboard();
    // highlight nothing in menu
  } else {
    showSection(last);
    // highlight active in menu
    $("#mainMenu").querySelectorAll("button[data-section]").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.section === last));
  }
}

function showSection(section) {
  // highlight active menu
  $("#mainMenu").querySelectorAll("button[data-section]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.section === section));
  // hide dashboard if not selected
  if (section !== "dashboard") $("#dashboard").innerHTML = "";
  // show the section
  if (section === "users") renderUsers();
  else if (section === "cars") renderCars();
  else if (section === "drivers") renderDrivers();
  else if (section === "assignments") renderAssignments();
  else renderDashboard();
}

async function renderDashboard() {
  // Try to fetch stats
  $("#dashboard").innerHTML = "<h2>Dashboard</h2><div>Loading...</div>";
  try {
    const stats = await api("/api/stats", "GET", null, token);
    $("#dashboard").innerHTML = `
      <div class="stats">
        <div class="stat stat-cars"><h3>Total Cars</h3><p>${stats.cars || 0}</p></div>
        <div class="stat stat-drivers"><h3>Total Drivers</h3><p>${stats.drivers || 0}</p></div>
        <div class="stat stat-assignments"><h3>Active Assignments</h3><p>${stats.activeAssignments || 0}</p></div>
      </div>
    `;
  } catch {
    $("#dashboard").innerHTML = "<div style='color:red'>Failed to load dashboard stats.</div>";
  }
  // Set as current section in memory
  localStorage.setItem("lastSection", "dashboard");
}

async function renderUsers() {
  $("#content").innerHTML = "<h2>Users</h2><div id='usersList'></div><div id='userForm'></div>";
  try {
    const users = await api("/api/users", "GET", null, token);
    $("#usersList").innerHTML = users.map(u =>
      `<div>${u.username} (${u.role})${u.role !== "admin" ? ` <button onclick="deleteUser(${u.id})">Delete</button>` : ""}</div>`
    ).join("");
  } catch (e) {
    $("#usersList").innerHTML = "<div style='color:red'>Failed to load users.</div>";
  }
  $("#userForm").innerHTML = `
    <h3>Add User</h3>
    <input id="newUser" placeholder="Username" />
    <input id="newPass" placeholder="Password" type="password" />
    <select id="newRole"><option value="user">User</option><option value="admin">Admin</option></select>
    <button id="addUserBtn">Add</button>
    <div id="userMsg"></div>
  `;
  $("#addUserBtn").onclick = addUser;
}
window.deleteUser = async id => {
  try {
    await api("/api/users/" + id, "DELETE", null, token);
    renderUsers();
    renderDashboard();
  } catch (e) {
    alert(e.message || "Failed to delete user");
  }
};
async function addUser() {
  const username = $("#newUser").value,
        password = $("#newPass").value,
        roleval = $("#newRole").value;
  if (!username || !password) return $("#userMsg").textContent = "Fields required";
  try {
    await api("/api/users", "POST", { username, password, role: roleval }, token);
    $("#userMsg").textContent = "";
    renderUsers();
    renderDashboard();
  } catch (e) {
    $("#userMsg").textContent = e.message || "Failed to add user";
  }
}

async function renderCars() {
  $("#content").innerHTML = "<h2>Cars</h2><div id='carsList'></div>" + (role === "admin" ? `
    <div>
      <input id="carPlate" placeholder="License Plate" />
      <input id="carModel" placeholder="Model" />
      <button id="addCarBtn">Add Car</button>
      <span id="carMsg" style="color:red"></span>
    </div>` : "");
  try {
    const cars = await api("/api/cars", "GET", null, token);
    $("#carsList").innerHTML = cars.map(c =>
      `<div>${c.license_plate} (${c.model})${role === "admin" ? ` <button onclick="deleteCar(${c.id})">Delete</button>` : ""}</div>`
    ).join("");
  } catch (e) {
    $("#carsList").innerHTML = "<div style='color:red'>Failed to load cars.</div>";
  }
  if (role === "admin") $("#addCarBtn").onclick = addCar;
}
async function addCar() {
  $("#carMsg").textContent = "";
  try {
    await api("/api/cars", "POST", { license_plate: $("#carPlate").value, model: $("#carModel").value }, token);
    renderCars();
    renderDashboard();
  } catch (e) {
    $("#carMsg").textContent = e.message || "Failed to add car";
  }
}
window.deleteCar = async id => {
  try {
    await api("/api/cars/" + id, "DELETE", null, token);
    renderCars();
    renderDashboard();
  } catch (e) {
    alert(e.message || "Failed to delete car");
  }
};

async function renderDrivers() {
  $("#content").innerHTML = "<h2>Drivers</h2><div id='driversList'></div>" + (role === "admin" ? `
    <div>
      <input id="driverName" placeholder="Name" />
      <input id="driverPhone" placeholder="Phone" />
      <button id="addDriverBtn">Add Driver</button>
      <span id="driverMsg" style="color:red"></span>
    </div>` : "");
  try {
    const drivers = await api("/api/drivers", "GET", null, token);
    $("#driversList").innerHTML = drivers.map(d =>
      `<div>${d.name} (${d.phone || ""})${role === "admin" ? ` <button onclick="deleteDriver(${d.id})">Delete</button>` : ""}</div>`
    ).join("");
  } catch (e) {
    $("#driversList").innerHTML = "<div style='color:red'>Failed to load drivers.</div>";
  }
  if (role === "admin") $("#addDriverBtn").onclick = addDriver;
}
async function addDriver() {
  $("#driverMsg").textContent = "";
  try {
    await api("/api/drivers", "POST", { name: $("#driverName").value, phone: $("#driverPhone").value }, token);
    renderDrivers();
    renderDashboard();
  } catch (e) {
    $("#driverMsg").textContent = e.message || "Failed to add driver";
  }
}
window.deleteDriver = async id => {
  try {
    await api("/api/drivers/" + id, "DELETE", null, token);
    renderDrivers();
    renderDashboard();
  } catch (e) {
    alert(e.message || "Failed to delete driver");
  }
};

async function renderAssignments() {
  $("#content").innerHTML = `<h2>Assignments</h2>
    <div id='assignForm'></div>
    <div id='assignmentsList'></div>`;
  let cars = [], drivers = [], assignments = [];
  try {
    [cars, drivers, assignments] = await Promise.all([
      api("/api/cars", "GET", null, token),
      api("/api/drivers", "GET", null, token),
      api("/api/assignments", "GET", null, token)
    ]);
  } catch (e) {
    $("#assignmentsList").innerHTML = "<div style='color:red'>Failed to load assignments.</div>";
    return;
  }
  $("#assignForm").innerHTML = `
    <select id="assignCar">${cars.filter(c => !assignments.some(a => a.car_id === c.id && !a.unassigned_at)).map(c => `<option value="${c.id}">${c.license_plate}</option>`)}</select>
    <select id="assignDriver">${drivers.filter(d => !assignments.some(a => a.driver_id === d.id && !a.unassigned_at)).map(d => `<option value="${d.id}">${d.name}</option>`)}</select>
    <input id="assignTime" type="datetime-local" />
    <button id="assignCarBtn">Assign</button>
    <span id="assignMsg" style="color:red"></span>
  `;
  $("#assignCarBtn").onclick = assignCar;
  $("#assignmentsList").innerHTML = assignments.map(a =>
    `<div>
      ${a.license_plate || ""} → ${a.driver_name || ""}
      | Assigned: ${a.assigned_at ? new Date(a.assigned_at).toLocaleString() : ""}
      | Unassigned: ${a.unassigned_at ? new Date(a.unassigned_at).toLocaleString() : ""}
      ${!a.unassigned_at ? `<button onclick="unassignCar(${a.car_id})">Unassign Now</button>` : ""}
    </div>`
  ).join("");
}
async function assignCar() {
  $("#assignMsg").textContent = "";
  const car_id = $("#assignCar").value,
        driver_id = $("#assignDriver").value,
        assignTime = $("#assignTime").value;
  if (!car_id || !driver_id || !assignTime) {
    $("#assignMsg").textContent = "All fields required";
    return;
  }
  try {
    await api("/api/assignments", "POST", {
      car_id,
      driver_id,
      assigned_at: new Date(assignTime).toISOString()
    }, token);
    renderAssignments();
    renderDashboard();
  } catch (e) {
    $("#assignMsg").textContent = e.message || "Failed to assign car";
  }
}
window.unassignCar = async (car_id) => {
  try {
    await api("/api/assignments/unassign", "POST", { car_id, unassigned_at: new Date().toISOString() }, token);
    renderAssignments();
    renderDashboard();
  } catch (e) {
    alert(e.message || "Failed to unassign car");
  }
};

// On load: render login or app
if (token) renderApp(); else renderLogin();
