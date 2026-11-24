const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
});

const monthFilter = document.getElementById('filtro-mes');
const exportLink = document.getElementById('exportar-csv');
const movementsBody = document.getElementById('lista-movimientos');
const form = document.getElementById('form-movimiento');
const modalElement = document.getElementById('modal-movimiento');
const movementModal = new bootstrap.Modal(modalElement);
const messageBox = document.getElementById('mensaje');
const loginPanel = document.getElementById('login-panel');
const appContent = document.getElementById('app-content');
const loginForm = document.getElementById('form-login');
const loginMessage = document.getElementById('login-message');
const logoutButton = document.getElementById('cerrar-sesion');
let editingId = null;
let csrfToken = null;

function showMessage(message, type) {
  messageBox.textContent = message;
  messageBox.className = `alert alert-${type}`;
}

function hideMessage() {
  messageBox.textContent = '';
  messageBox.className = 'alert d-none';
}

function showLoginMessage(message) {
  loginMessage.textContent = message;
  loginMessage.hidden = false;
}

function setAuthenticated(authenticated) {
  loginPanel.hidden = authenticated;
  appContent.hidden = !authenticated;
  logoutButton.hidden = !authenticated;
}

async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && url !== '/api/auth/login') {
    await expireSession();
  }
  if (response.status === 204) {
    return null;
  }
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'No se pudo completar la solicitud.');
  }
  return result;
}

function appendCell(row, value, className) {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) {
    cell.className = className;
  }
  row.appendChild(cell);
  return cell;
}

function renderMovements(movements) {
  movementsBody.replaceChildren();
  if (movements.length === 0) {
    const row = document.createElement('tr');
    const cell = appendCell(row, 'No hay movimientos para este periodo.', 'text-center text-secondary py-4');
    cell.colSpan = 6;
    movementsBody.appendChild(row);
    return;
  }

  movements.forEach((movement) => {
    const row = document.createElement('tr');
    appendCell(row, movement.fecha.slice(0, 10).split('-').reverse().join('/'));
    appendCell(row, movement.concepto);
    appendCell(row, movement.categoria);
    const typeCell = appendCell(row, movement.tipo === 'ingreso' ? 'Ingreso' : 'Gasto');
    typeCell.classList.add(movement.tipo === 'ingreso' ? 'text-success' : 'text-danger');
    appendCell(row, currency.format(Number(movement.monto)), 'text-end text-nowrap');

    const actions = document.createElement('td');
    actions.className = 'text-end text-nowrap';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-sm btn-outline-primary me-2';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => openEditForm(movement));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-sm btn-outline-danger';
    deleteButton.textContent = 'Eliminar';
    deleteButton.addEventListener('click', () => deleteMovement(movement));
    actions.append(editButton, deleteButton);
    row.appendChild(actions);
    movementsBody.appendChild(row);
  });
}

function updateSummary(summary) {
  document.getElementById('total-ingresos').textContent = currency.format(summary.ingresos);
  document.getElementById('total-gastos').textContent = currency.format(summary.gastos);
  const balance = document.getElementById('total-saldo');
  balance.textContent = currency.format(summary.saldo);
  balance.className = `h3 mb-0 ${summary.saldo < 0 ? 'text-danger' : 'text-success'}`;
}

function clearDashboard() {
  renderMovements([]);
  updateSummary({ ingresos: 0, gastos: 0, saldo: 0 });
  monthFilter.value = '';
  resetForm();
}

async function expireSession() {
  setAuthenticated(false);
  clearDashboard();
  try {
    const response = await fetch('/api/auth/session');
    const result = await response.json();
    csrfToken = response.ok ? result.csrfToken : null;
  } catch {
    csrfToken = null;
  }
  showLoginMessage('La sesión expiró. Inicia sesión nuevamente.');
}

async function loadMovements() {
  hideMessage();
  const query = monthFilter.value ? `?mes=${encodeURIComponent(monthFilter.value)}` : '';
  exportLink.href = `/api/movimientos/exportar.csv${query}`;
  try {
    const result = await request(`/api/movimientos${query}`);
    renderMovements(result.movimientos);
    updateSummary(result.resumen);
    return true;
  } catch (error) {
    showMessage(error.message, 'danger');
    movementsBody.replaceChildren();
    const row = document.createElement('tr');
    const cell = appendCell(row, 'No fue posible cargar los movimientos.', 'text-center text-danger py-4');
    cell.colSpan = 6;
    movementsBody.appendChild(row);
    return false;
  }
}

function resetForm() {
  form.reset();
  editingId = null;
  const today = new Date();
  document.getElementById('fecha').value = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');
  document.getElementById('tipo').value = 'gasto';
  document.getElementById('modal-titulo').textContent = 'Agregar movimiento';
}

function openEditForm(movement) {
  editingId = movement.id;
  document.getElementById('fecha').value = movement.fecha.slice(0, 10);
  document.getElementById('concepto').value = movement.concepto;
  document.getElementById('categoria').value = movement.categoria;
  document.getElementById('tipo').value = movement.tipo;
  document.getElementById('monto').value = Number(movement.monto).toFixed(2);
  document.getElementById('modal-titulo').textContent = 'Editar movimiento';
  movementModal.show();
}

async function deleteMovement(movement) {
  if (!window.confirm(`¿Eliminar "${movement.concepto}"? Esta acción no se puede deshacer.`)) {
    return;
  }
  try {
    await request(`/api/movimientos/${movement.id}`, { method: 'DELETE' });
    if (await loadMovements()) {
      showMessage('Movimiento eliminado.', 'success');
    }
  } catch (error) {
    showMessage(error.message, 'danger');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }
  const data = new FormData(form);
  const payload = {
    fecha: data.get('fecha'),
    concepto: data.get('concepto'),
    categoria: data.get('categoria'),
    tipo: data.get('tipo'),
    monto: data.get('monto')
  };
  const url = editingId ? `/api/movimientos/${editingId}` : '/api/movimientos';
  const method = editingId ? 'PUT' : 'POST';
  const wasEditing = Boolean(editingId);

  try {
    await request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    movementModal.hide();
    resetForm();
    if (await loadMovements()) {
      showMessage(wasEditing ? 'Movimiento actualizado.' : 'Movimiento agregado.', 'success');
    }
  } catch (error) {
    showMessage(error.message, 'danger');
  }
});

modalElement.addEventListener('hidden.bs.modal', resetForm);
monthFilter.addEventListener('change', loadMovements);
document.getElementById('limpiar-filtro').addEventListener('click', () => {
  monthFilter.value = '';
  loadMovements();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.hidden = true;
  const formData = new FormData(loginForm);
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: formData.get('password') })
    });
    csrfToken = result.csrfToken;
    loginForm.reset();
    setAuthenticated(true);
    await loadMovements();
  } catch (error) {
    showLoginMessage(error.message);
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    const result = await request('/api/auth/logout', { method: 'POST' });
    csrfToken = result.csrfToken;
    movementModal.hide();
    clearDashboard();
    setAuthenticated(false);
    loginForm.reset();
    loginMessage.hidden = true;
  } catch (error) {
    showMessage(error.message, 'danger');
  }
});

async function initializeAuthentication() {
  try {
    const result = await request('/api/auth/session');
    csrfToken = result.csrfToken;
    setAuthenticated(result.authenticated);
    if (result.authenticated) {
      await loadMovements();
    }
  } catch (error) {
    setAuthenticated(false);
    showLoginMessage('No fue posible verificar la sesión. Recarga la página para volver a intentar.');
  }
}

resetForm();
initializeAuthentication();
