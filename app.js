// Admin App
let adminPassword = '';
let currentCategoryId = null;
let ordersRefreshInterval = null;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// API Helper
async function apiCall(endpoint, options = {}) {
  const url = `${CONFIG.API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (adminPassword) headers['Authorization'] = `Bearer ${adminPassword}`;
  
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// Toast
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// Login
function requireLogin() {
  const modal = $('#loginModal');
  modal.classList.remove('hidden');
  
  $('#loginSubmit').onclick = () => {
    const pwd = $('#adminPasswordInput').value.trim();
    if (!pwd) return alert('Inserisci la password');
    adminPassword = pwd;
    modal.classList.add('hidden');
    boot();
  };
}

// Tabs
function setupTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      $$('.tab').forEach(t => t.classList.remove('active'));
      $(`#tab-${id}`).classList.add('active');
      
      if (id === 'stats') setTimeout(() => renderStats(), 50);
      if (id === 'orders') {
        renderOrders();
        startOrdersAutoRefresh();
      } else {
        stopOrdersAutoRefresh();
      }
    };
  });
}

// TAVOLI
function formatElapsedTime(openedAt) {
  const now = Date.now();
  const diff = now - openedAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function checkPendingOrders(tableId) {
  try {
    const params = new URLSearchParams();
    params.append('table_id', tableId);
    params.append('state', 'richiesta');
    const { orders } = await apiCall(`/orders?${params}`);
    return orders.length > 0;
  } catch (e) {
    return false;
  }
}

async function renderTables() {
  try {
    const { tables } = await apiCall('/tables');
    const list = $('#tablesList');
    list.innerHTML = '';
    
    const filterSel = $('#ordersFilterTable');
    filterSel.innerHTML = '<option value="">Tutti i tavoli</option>';
    
    for (const table of tables) {
      const opt = document.createElement('option');
      opt.value = table.id;
      opt.textContent = `Tavolo ${table.id}`;
      filterSel.appendChild(opt);
      
      const card = document.createElement('div');
      card.className = 'card table-card';
      
      let badge = `<span class="badge closed">Non attivo</span>`;
      let timer = '';
      let buttons = `
        <button data-act="open" data-id="${table.id}" class="btn primary">Apri sessione</button>
        <button data-act="qr" data-id="${table.id}" class="btn">Mostra QR</button>
      `;
      
      if (table.active_session) {
        const elapsed = formatElapsedTime(table.active_session.opened_at);
        const hasPending = await checkPendingOrders(table.id);
        
        if (hasPending) {
          badge = `<span class="badge has-pending">In sessione · PIN ${table.active_session.pin}</span>`;
          card.classList.add('has-pending-orders');
        } else {
          badge = `<span class="badge open">In sessione · PIN ${table.active_session.pin}</span>`;
        }
        
        timer = `<div class="table-timer">⏱️ Aperto da: ${elapsed}</div>`;
        buttons = `
          <button data-act="close" data-id="${table.id}" class="btn danger">Chiudi sessione</button>
          <button data-act="reset" data-id="${table.id}" class="btn warn">Reset (nuovo PIN)</button>
          <button data-act="qr" data-id="${table.id}" class="btn">Mostra QR</button>
        `;
      }
      
      card.innerHTML = `
        <h3>Tavolo ${table.id} ${badge}</h3>
        ${timer}
        <div class="row">
          ${buttons}
        </div>
      `;
      
      if (table.active_session) {
        card.querySelector('[data-act="close"]').onclick = () => closeSession(table.id);
        card.querySelector('[data-act="reset"]').onclick = () => resetSession(table.id);
      } else {
        card.querySelector('[data-act="open"]').onclick = () => openSession(table.id);
      }
      card.querySelector('[data-act="qr"]').onclick = () => showQr(table.id);
      
      list.appendChild(card);
    }
    
    // Aggiorna timer ogni minuto
    setTimeout(renderTables, 60000);
  } catch (e) {
    toast('Errore caricamento tavoli: ' + e.message);
  }
}

async function openSession(tableId) {
  try {
    const { pin } = await apiCall('/session/open', {
      method: 'POST',
      body: JSON.stringify({ table_id: tableId })
    });
    
    $('#pinModalTable').textContent = tableId;
    $('#pinDigits').textContent = pin;
    $('#pinModal').classList.remove('hidden');
    
    renderTables();
  } catch (e) {
    toast('Errore apertura sessione: ' + e.message);
  }
}

async function closeSession(tableId) {
  if (!confirm(`Chiudere definitivamente la sessione del Tavolo ${tableId}?`)) return;
  
  try {
    await apiCall('/session/close', {
      method: 'POST',
      body: JSON.stringify({ table_id: tableId })
    });
    
    toast(`Sessione Tavolo ${tableId} chiusa.`);
    renderTables();
  } catch (e) {
    toast('Errore chiusura sessione: ' + e.message);
  }
}

async function resetSession(tableId) {
  if (!confirm(`Reset sessione Tavolo ${tableId}? Verrà generato un nuovo PIN.`)) return;
  
  try {
    await apiCall('/session/close', {
      method: 'POST',
      body: JSON.stringify({ table_id: tableId })
    });
    
    const { pin } = await apiCall('/session/open', {
      method: 'POST',
      body: JSON.stringify({ table_id: tableId })
    });
    
    $('#pinModalTable').textContent = tableId;
    $('#pinDigits').textContent = pin;
    $('#pinModal').classList.remove('hidden');
    
    toast(`Nuovo PIN generato per Tavolo ${tableId}`);
    renderTables();
  } catch (e) {
    toast('Errore reset sessione: ' + e.message);
  }
}

function showQr(tableId) {
  const base = CONFIG.ORDERS_SITE_BASE;
  const url = `${base}?table=${tableId}`;
  
  $('#qrTableNumber').textContent = tableId;
  $('#qrLink').textContent = url;
  
  const cont = $('#qrContainer');
  cont.innerHTML = '';
  const size = Math.min(320, Math.floor(window.innerWidth * 0.8));
  new QRCode(cont, { text: url, width: size, height: size });
  
  $('#qrModal').classList.remove('hidden');
}

$('#closePinModal').onclick = () => $('#pinModal').classList.add('hidden');
$('#closeQrModal').onclick = () => $('#qrModal').classList.add('hidden');

$('#addTableBtn').onclick = async () => {
  const id = $('#newTableId').value.trim();
  if (!id || !/^\d+$/.test(id)) return alert('Inserisci ID numerico');
  
  try {
    await apiCall('/tables', {
      method: 'POST',
      body: JSON.stringify({ id: parseInt(id), label: `Tavolo ${id}` })
    });
    $('#newTableId').value = '';
    toast(`Tavolo ${id} creato`);
    renderTables();
  } catch (e) {
    toast('Errore creazione tavolo: ' + e.message);
  }
};

// ORDINI
function startOrdersAutoRefresh() {
  if (ordersRefreshInterval) return;
  ordersRefreshInterval = setInterval(renderOrders, 5000);
}

function stopOrdersAutoRefresh() {
  if (ordersRefreshInterval) {
    clearInterval(ordersRefreshInterval);
    ordersRefreshInterval = null;
  }
}

async function renderOrders() {
  try {
    const tableFilter = $('#ordersFilterTable').value;
    const stateFilter = $('#ordersFilterState').value;
    
    const params = new URLSearchParams();
    if (tableFilter) params.append('table_id', tableFilter);
    if (stateFilter) params.append('state', stateFilter);
    
    const { orders } = await apiCall(`/orders?${params}`);
    const list = $('#ordersList');
    list.innerHTML = '';
    
    if (orders.length === 0) {
      list.innerHTML = '<div class="card"><p class="hint">Nessun ordine trovato.</p></div>';
      return;
    }
    
    orders.forEach(order => {
      const card = document.createElement('div');
      let cardClass = 'order-card pending';
      if (order.state === 'servito') cardClass = 'order-card servito';
      if (order.state === 'annullato') cardClass = 'order-card annullato';
      
      card.className = cardClass;
      
      const itemsHtml = order.items.map(it => 
        `<div>${it.item_name} <strong>×${it.quantity}</strong> — ${parseFloat(it.unit_price_eur).toFixed(2)}€</div>`
      ).join('');
      
      const date = new Date(order.created_at).toLocaleString('it-IT');
      
      let statusIcon = '⏳';
      let statusText = 'In attesa';
      if (order.state === 'servito') { statusIcon = '✅'; statusText = 'Servito'; }
      if (order.state === 'annullato') { statusIcon = '❌'; statusText = 'Annullato'; }
      
      card.innerHTML = `
        <div class="order-header">
          <strong>Tavolo ${order.table_id}</strong>
          <span>${statusIcon} ${statusText}</span>
        </div>
        <div class="hint">${date}</div>
        <div class="order-items">${itemsHtml}</div>
        <div class="order-actions">
          <button data-act="served" data-id="${order.id}" class="btn ok">✅ Servito</button>
          <button data-act="cancel" data-id="${order.id}" class="btn danger">❌ Annulla</button>
        </div>
      `;
      
      card.querySelector('[data-act="served"]').onclick = () => changeOrderState(order.id, 'servito');
      card.querySelector('[data-act="cancel"]').onclick = () => changeOrderState(order.id, 'annullato');
      
      list.appendChild(card);
    });
  } catch (e) {
    toast('Errore caricamento ordini: ' + e.message);
  }
}

async function changeOrderState(orderId, newState) {
  try {
    await apiCall(`/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: newState })
    });
    toast(`Ordine ${newState}`);
    renderOrders();
    renderTables(); // Aggiorna anche i tavoli per rimuovere il bordo giallo
  } catch (e) {
    toast('Errore aggiornamento ordine: ' + e.message);
  }
}

$('#ordersFilterTable').onchange = renderOrders;
$('#ordersFilterState').onchange = renderOrders;

// MENÙ
async function renderMenu() {
  try {
    const { categories, items } = await apiCall('/menu/admin');
    
    const ul = $('#categoryList');
    ul.innerHTML = '';
    
    categories.forEach(cat => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${cat.name}</span>
        <div class="row">
          <button class="btn" data-act="select">Apri</button>
          <button class="btn" data-act="rename">Rinomina</button>
          <button class="btn danger" data-act="delete">Elimina</button>
        </div>
      `;
      
      li.querySelector('[data-act="select"]').onclick = () => {
        currentCategoryId = cat.id;
        renderItems(items.filter(i => i.category_id === cat.id), cat.name);
      };
      
      li.querySelector('[data-act="rename"]').onclick = async () => {
        const name = prompt('Nuovo nome categoria', cat.name);
        if (!name) return;
        try {
          await apiCall(`/menu/categories/${cat.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
          });
          toast('Categoria rinominata');
          renderMenu();
        } catch (e) {
          toast('Errore: ' + e.message);
        }
      };
      
      li.querySelector('[data-act="delete"]').onclick = async () => {
        if (!confirm('Eliminare categoria e articoli?')) return;
        try {
          await apiCall(`/menu/categories/${cat.id}`, { method: 'DELETE' });
          toast('Categoria eliminata');
          renderMenu();
        } catch (e) {
          toast('Errore: ' + e.message);
        }
      };
      
      ul.appendChild(li);
    });
    
    if (!*

