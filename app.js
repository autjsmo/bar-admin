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
    
    if (!currentCategoryId && categories[0]) {
      currentCategoryId = categories[0].id;
      renderItems(items.filter(i => i.category_id === categories[0].id), categories[0].name);
    }
  } catch (e) {
    toast('Errore caricamento menù: ' + e.message);
  }
}

function renderItems(items, categoryName) {
  $('#itemsTitle').textContent = `Articoli · ${categoryName}`;
  const list = $('#itemsList');
  list.innerHTML = '';
  
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    
    const tags = item.tags ? JSON.parse(item.tags).filter(t => t.toLowerCase() !== 'bio') : [];
    const tagsHtml = tags.length ? `<div class="hint">🏷️ ${tags.join(' · ')}</div>` : '';
    
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <strong>${item.name}</strong>
        <span style="font-size:17px;font-weight:700;color:var(--primary)">${parseFloat(item.price_eur).toFixed(2)} €</span>
      </div>
      ${item.description ? `<div class="hint">${item.description}</div>` : ''}
      ${tagsHtml}
      <div class="hint">${item.visible ? '👁️ Visibile' : '🚫 Nascosto'}</div>
      <div class="row" style="justify-content:flex-end">
        <button data-act="edit" class="btn">Modifica</button>
        <button data-act="delete" class="btn danger">Elimina</button>
      </div>
    `;
    
    card.querySelector('[data-act="edit"]').onclick = () => editItem(item);
    card.querySelector('[data-act="delete"]').onclick = () => deleteItem(item.id);
    
    list.appendChild(card);
  });
}

async function editItem(item) {
  const name = prompt('Nome', item.name) || item.name;
  const price = prompt('Prezzo (€)', item.price_eur) || item.price_eur;
  const desc = prompt('Descrizione', item.description || '') || item.description;
  const visible = confirm('Articolo visibile? OK=sì');
  
  try {
    await apiCall(`/menu/items/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, price_eur: parseFloat(price), description: desc, visible })
    });
    toast('Articolo aggiornato');
    renderMenu();
  } catch (e) {
    toast('Errore: ' + e.message);
  }
}

async function deleteItem(itemId) {
  if (!confirm('Eliminare articolo?')) return;
  try {
    await apiCall(`/menu/items/${itemId}`, { method: 'DELETE' });
    toast('Articolo eliminato');
    renderMenu();
  } catch (e) {
    toast('Errore: ' + e.message);
  }
}

$('#addCategoryBtn').onclick = async () => {
  const name = $('#newCategoryName').value.trim();
  if (!name) return alert('Inserisci nome categoria');
  
  try {
    await apiCall('/menu/categories', {
      method: 'POST',
      body: JSON.stringify({ name, position: 999 })
    });
    $('#newCategoryName').value = '';
    toast('Categoria aggiunta');
    renderMenu();
  } catch (e) {
    toast('Errore: ' + e.message);
  }
};

$('#addItemBtn').onclick = async () => {
  if (!currentCategoryId) return alert('Seleziona una categoria');
  
  const name = $('#itemName').value.trim();
  const price = parseFloat($('#itemPrice').value);
  if (!name || isNaN(price) || price < 0) return alert('Nome e prezzo validi richiesti');
  
  const desc = $('#itemDescription').value.trim();
  const tags = [];
  if ($('#itemTagNovita').checked) tags.push('Novità');
  const visible = $('#itemVisible').checked;
  
  try {
    await apiCall('/menu/items', {
      method: 'POST',
      body: JSON.stringify({
        category_id: currentCategoryId,
        name,
        price_eur: price,
        description: desc,
        tags,
        visible,
        position: 999
      })
    });
    
    $('#itemName').value = '';
    $('#itemPrice').value = '';
    $('#itemDescription').value = '';
    $('#itemTagNovita').checked = false;
    $('#itemVisible').checked = true;
    
    toast('Articolo aggiunto');
    renderMenu();
  } catch (e) {
    toast('Errore: ' + e.message);
  }
};

$('#exportMenuJsonBtn').onclick = async () => {
  try {
    const { categories, items } = await apiCall('/menu/admin');
    const blob = new Blob([JSON.stringify({ categories, items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'menu.json';
    a.click();
  } catch (e) {
    toast('Errore export: ' + e.message);
  }
};

$('#importMenuJsonBtn').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json';
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      alert('Import manuale: usa console SQL D1 per import massivo.');
    } catch (e) {
      alert('Errore JSON: ' + e.message);
    }
  };
  inp.click();
};

// STATISTICHE
let topItemsChart, tablesOpenedChart;

async function renderStats() {
  try {
    const from = $('#statsFrom').value;
    const to = $('#statsTo').value;
    
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    
    const [topItems, tablesOpened] = await Promise.all([
      apiCall(`/stats/top-items?${params}`),
      apiCall(`/stats/tables-opened?${params}`)
    ]);
    
    if (topItemsChart) topItemsChart.destroy();
    topItemsChart = new Chart($('#topItemsChart'), {
      type: 'bar',
      data: {
        labels: topItems.top_items.map(i => i.item_name),
        datasets: [{
          label: 'Quantità venduta',
          data: topItems.top_items.map(i => i.total),
          backgroundColor: '#3b82f6',
          borderRadius: 8
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    
    if (tablesOpenedChart) tablesOpenedChart.destroy();
    tablesOpenedChart = new Chart($('#tablesOpenedChart'), {
      type: 'line',
      data: {
        labels: tablesOpened.tables_opened.map(t => t.day),
        datasets: [{
          label: 'Tavoli aperti',
          data: tablesOpened.tables_opened.map(t => t.count),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,.2)',
          tension: 0.3,
          fill: true
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } catch (e) {
    toast('Errore statistiche: ' + e.message);
  }
}

$('#refreshStats').onclick = renderStats;

$('#exportStatsCsv').onclick = async () => {
  try {
    const from = $('#statsFrom').value;
    const to = $('#statsTo').value;
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    
    const [topItems, tablesOpened] = await Promise.all([
      apiCall(`/stats/top-items?${params}`),
      apiCall(`/stats/tables-opened?${params}`)
    ]);
    
    let csv = 'giorno,tavoli_aperti\n';
    tablesOpened.tables_opened.forEach(t => csv += `${t.day},${t.count}\n`);
    csv += '\nprodotto,quantita\n';
    topItems.top_items.forEach(i => csv += `${i.item_name},${i.total}\n`);
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'statistiche.csv';
    a.click();
  } catch (e) {
    toast('Errore export CSV: ' + e.message);
  }
};

// Boot
async function boot() {
  try {
    await renderTables();
    await renderMenu();
    await renderStats();
  } catch (e) {
    if (e.message.includes('401')) {
      alert('Password errata o non autorizzato');
      adminPassword = '';
      requireLogin();
    } else {
      toast('Errore inizializzazione: ' + e.message);
    }
  }
}

// Init
setupTabs();
requireLogin();
