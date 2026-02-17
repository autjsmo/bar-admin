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
        <h3 class="table-header" data-table-id="${table.id}" data-has-session="${table.active_session ? 'true' : 'false'}">Tavolo ${table.id} ${badge}</h3>
        ${timer}
        <div class="row">
          ${buttons}
        </div>
      `;
      
      // Click sul titolo per vedere dettagli ordini
      card.querySelector('.table-header').onclick = () => showTableDetails(table.id, table.active_session);
      
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

async function showTableDetails(tableId, activeSession) {
  if (!activeSession) {
    toast('Nessuna sessione attiva per questo tavolo');
    return;
  }
  
  try {
    const params = new URLSearchParams();
    params.append('table_id', tableId);
    
    const { orders } = await apiCall(`/orders?${params}`);
    
    // Controlla se ci sono ordini in attesa
    const pendingOrders = orders.filter(o => o.state === 'richiesta');
    
    if (pendingOrders.length > 0) {
      // Vai alla sezione ordini e filtra per questo tavolo
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-btn')[1].classList.add('active'); // Ordini è il secondo tab
      $$('.tab').forEach(t => t.classList.remove('active'));
      $('#tab-orders').classList.add('active');
      
      $('#ordersFilterTable').value = tableId;
      $('#ordersFilterState').value = 'richiesta';
      await renderOrders();
      startOrdersAutoRefresh();
      
      toast(`${pendingOrders.length} ordine/i in attesa per Tavolo ${tableId}`);
    } else {
      // Mostra riepilogo sessione completa
      showSessionSummary(tableId, orders, activeSession);
    }
  } catch (e) {
    toast('Errore caricamento dettagli: ' + e.message);
  }
}

function showSessionSummary(tableId, orders, session) {
  // Calcola totali
  const servedOrders = orders.filter(o => o.state === 'servito');
  const canceledOrders = orders.filter(o => o.state === 'annullato');
  
  let totalRevenue = 0;
  const itemsSummary = new Map();
  
  servedOrders.forEach(order => {
    order.items.forEach(item => {
      const revenue = item.quantity * parseFloat(item.unit_price_eur);
      totalRevenue += revenue;
      
      if (itemsSummary.has(item.item_name)) {
        const existing = itemsSummary.get(item.item_name);
        existing.quantity += item.quantity;
        existing.revenue += revenue;
      } else {
        itemsSummary.set(item.item_name, {
          quantity: item.quantity,
          price: parseFloat(item.unit_price_eur),
          revenue
        });
      }
    });
  });
  
  // Crea modal
  const existingModal = $('#sessionSummaryModal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'sessionSummaryModal';
  modal.className = 'modal';
  
  const itemsList = Array.from(itemsSummary.entries()).map(([name, data]) => {
    return `
      <div class="product-item">
        <span class="product-name">${name}</span>
        <span class="product-qty">×${data.quantity}</span>
        <span class="product-revenue">${data.revenue.toFixed(2)} €</span>
      </div>
    `;
  }).join('');
  
  const elapsed = formatElapsedTime(session.opened_at);
  const openedDate = new Date(session.opened_at).toLocaleString('it-IT');
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>📊 Riepilogo Tavolo ${tableId}</h2>
      <div style="background:var(--bg);padding:16px;border-radius:12px;margin:16px 0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">
          <div><strong>PIN:</strong> ${session.pin}</div>
          <div><strong>Durata:</strong> ${elapsed}</div>
          <div style="grid-column:1/-1"><strong>Apertura:</strong> ${openedDate}</div>
        </div>
      </div>
      
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0">
        <div style="background:linear-gradient(135deg, #22c55e, #16a34a);padding:16px;border-radius:12px;text-align:center;color:#fff">
          <div style="font-size:28px;font-weight:900">${servedOrders.length}</div>
          <div style="font-size:13px;opacity:0.9">Serviti</div>
        </div>
        <div style="background:linear-gradient(135deg, #ef4444, #dc2626);padding:16px;border-radius:12px;text-align:center;color:#fff">
          <div style="font-size:28px;font-weight:900">${canceledOrders.length}</div>
          <div style="font-size:13px;opacity:0.9">Annullati</div>
        </div>
        <div style="background:linear-gradient(135deg, #3b82f6, #1d4ed8);padding:16px;border-radius:12px;text-align:center;color:#fff">
          <div style="font-size:28px;font-weight:900">${totalRevenue.toFixed(0)}€</div>
          <div style="font-size:13px;opacity:0.9">Totale</div>
        </div>
      </div>
      
      ${itemsSummary.size > 0 ? `
        <h3 style="margin:24px 0 12px 0">Articoli serviti</h3>
        <div class="product-list" style="max-height:40vh;overflow-y:auto">
          ${itemsList}
        </div>
      ` : '<p class="hint" style="text-align:center;padding:20px">Nessun ordine servito in questa sessione.</p>'}
      
      <div style="margin-top:24px;padding-top:20px;border-top:2px solid var(--border);text-align:center">
        <strong style="font-size:22px;color:var(--primary)">Totale: ${totalRevenue.toFixed(2)} €</strong>
      </div>
      
      <div style="margin-top:24px;text-align:center">
        <button id="closeSessionSummaryModal" class="btn primary">Chiudi</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  $('#closeSessionSummaryModal').onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
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
    
    if*

