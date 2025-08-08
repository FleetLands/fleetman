const $ = s => document.querySelector(s);
const api = (url, method = "GET", body = null, token = null) =>
  fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: "Bearer " + token }),
    },
    ...(body && { body: JSON.stringify(body) }),
  }).then(r => r.json());

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
    const res = await api("/api/auth/login", "POST", { username, password });
    if (res.token) {
      localStorage.setItem("token", res.token);
      localStorage.setItem("role", res.role);
      token = res.token; role = res.role;
      renderApp();
    } else {
      $("#loginError").textContent = res.message || "Login failed";
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
    <div id="content"></div>
  `;
  const menu = [];
  if (role === "admin") menu.push(`<button onclick="renderUsers()">Users</button>`);
  menu.push(
    `<button onclick="renderCars()">Cars</button>`,
    `<button onclick="renderDrivers()">Drivers</button>`,
    `<button onclick="renderAssignments()">Assignments</button>`
  );
  $("#mainMenu").innerHTML = menu.join(" ");
  renderCars();
}

async function renderUsers() {
  $("#content").innerHTML = "<h2>Users</h2><div id='usersList'></div><div id='userForm'></div>";
  const users = await api("/api/users", "GET", null, token);
  $("#usersList").innerHTML = users.map(u =>
    `<div>${u.username} (${u.role})${u.role !== "admin" ? ` <button onclick="deleteUser(${u.id})">Delete</button>` : ""}</div>`
  ).join("");
  $("#userForm").innerHTML = `
    <h3>Add User</h3>
    <input id="newUser" placeholder="Username" />
    <input id="newPass" placeholder="Password" type="password" />
    <select id="newRole"><option value="user">User</option><option value="admin">Admin</option></select>
    <button onclick="addUser()">Add</button>
    <div id="userMsg"></div>
  `;
}
window.deleteUser = async id => {
  await api("/api/users/" + id, "DELETE", null, token);
  renderUsers();
};
window.addUser = async () => {
  const username = $("#newUser").value,
        password = $("#newPass").value,
        role = $("#newRole").value;
  if (!username || !password) return $("#userMsg").textContent = "Fields required";
  await api("/api/users", "POST", { username, password, role }, token);
  renderUsers();
};

async function renderCars() {
  $("#content").innerHTML = "<h2>Cars</h2><div id='carsList'></div>" + (role === "admin" ? `
    <div>
      <input id="carPlate" placeholder="License Plate" />
      <input id="carModel" placeholder="Model" />
      <button onclick="addCar()">Add Car</button>
    </div>` : "");
  const cars = await api("/api/cars", "GET", null, token);
  $("#carsList").innerHTML = cars.map(c =>
    `<div>${c.license_plate} (${c.model})${role === "admin" ? ` <button onclick="deleteCar(${c.id})">Delete</button>` : ""}</div>`
  ).join("");
}
window.addCar = async () => {
  await api("/api/cars", "POST", { license_plate: $("#carPlate").value, model: $("#carModel").value }, token);
  renderCars();
};
window.deleteCar = async id => {
  await api("/api/cars/" + id, "DELETE", null, token);
  renderCars();
};

async function renderDrivers() {
  $("#content").innerHTML = "<h2>Drivers</h2><div id='driversList'></div>" + (role === "admin" ? `
    <div>
      <input id="driverName" placeholder="Name" />
      <input id="driverPhone" placeholder="Phone" />
      <button onclick="addDriver()">Add Driver</button>
    </div>` : "");
  const drivers = await api("/api/drivers", "GET", null, token);
  $("#driversList").innerHTML = drivers.map(d =>
    `<div>${d.name} (${d.phone || ""})${role === "admin" ? ` <button onclick="deleteDriver(${d.id})">Delete</button>` : ""}</div>`
  ).join("");
}
window.addDriver = async () => {
  await api("/api/drivers", "POST", { name: $("#driverName").value, phone: $("#driverPhone").value }, token);
  renderDrivers();
};
window.deleteDriver = async id => {
  await api("/api/drivers/" + id, "DELETE", null, token);
  renderDrivers();
};

async function renderAssignments() {
  $("#content").innerHTML = "<h2>Assignments</h2><div id='assignForm'></div><div id='assignmentsList'></div>";
  const [cars, drivers, assignments] = await Promise.all([
    api("/api/cars", "GET", null, token),
    api("/api/drivers", "GET", null, token),
    api("/api/assignments", "GET", null, token)
  ]);
  $("#assignForm").innerHTML = `
    <select id="assignCar">${cars.map(c => `<option value="${c.id}">${c.license_plate}</option>`)}</select>
    <select id="assignDriver">${drivers.map(d => `<option value="${d.id}">${d.name}</option>`)}</select>
    <button onclick="assignCar()">Assign</button>
    <button onclick="unassignCar()">Unassign</button>
  `;
  $("#assignmentsList").innerHTML = assignments.map(a =>
    `<div>
      ${a.license_plate || ""} → ${a.driver_name || ""}
      | Assigned: ${a.assigned_at ? new Date(a.assigned_at).toLocaleString() : ""}
      | Unassigned: ${a.unassigned_at ? new Date(a.unassigned_at).toLocaleString() : ""}
      ${a.unassigned_at ? "" : `<button onclick="unassignCar(${a.car_id})">Unassign Now</button>`}
    </div>`
  ).join("");
}
window.assignCar = async () => {
  await api("/api/assignments", "POST", {
    car_id: $("#assignCar").value,
    driver_id: $("#assignDriver").value,
    assigned_at: new Date()
  }, token);
  renderAssignments();
};
window.unassignCar = async (car_id) => {
  car_id = car_id || $("#assignCar").value;
  await api("/api/assignments/unassign", "POST", { car_id, unassigned_at: new Date() }, token);
  renderAssignments();
};

if (token) renderApp(); else renderLogin();