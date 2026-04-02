import { logout, checkAuthState } from "/auth.js";

const startBtn = document.getElementById('start-btn');
const loginCompleteBtn = document.getElementById('login-complete-btn');
const sfUrlInput = document.getElementById('sf-url');
const propertyNameInput = document.getElementById('property-name');
const logContainer = document.getElementById('log-container');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const sfUserInput = document.getElementById('sf-user');
const sfPassInput = document.getElementById('sf-pass');
const gftUserInput = document.getElementById('gft-user');
const gftPassInput = document.getElementById('gft-pass');
const downloadPathInput = document.getElementById('download-path');

// Report Elements
const reportGrid = document.getElementById('report-grid');
const idReportList = document.getElementById('report-list');
const newReportName = document.getElementById('new-report-name');
const newReportUrl = document.getElementById('new-report-url');
const addReportBtn = document.getElementById('add-report-btn');

// Render Reports to Grid and Settings List
function renderReports() {
  const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
  const reports = settings.reports || [];

  // Update Main Grid
  if (reports.length === 0) {
    reportGrid.innerHTML = '<p class="empty-msg">設定からレポートを登録するとここにボタンが表示されます。</p>';
  } else {
    reportGrid.innerHTML = reports.map((rpt, idx) => `
      <button class="report-btn" data-url="${rpt.url}">
        <span>📊</span> ${rpt.name}
      </button>
    `).join('');
  }

  // Update Settings List
  idReportList.innerHTML = reports.map((rpt, idx) => `
    <div class="report-item">
      <div class="report-item-info">
        <span class="report-item-name">${rpt.name}</span>
        <span class="report-item-url">${rpt.url}</span>
      </div>
      <button class="del-btn" data-idx="${idx}">削除</button>
    </div>
  `).join('');
}

// Add New Report
function addReport() {
  const name = newReportName.value.trim();
  const url = newReportUrl.value.trim();

  if (!name || !url) {
    alert('名前とURLの両方を入力してください');
    return;
  }

  const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
  if (!settings.reports) settings.reports = [];
  
  settings.reports.push({ name, url });
  localStorage.setItem('sekoujimu_settings', JSON.stringify(settings));
  
  newReportName.value = '';
  newReportUrl.value = '';
  renderReports();
  addLog(`レポート「${name}」を登録しました`, 'success');
}

// Delete Report
function deleteReport(idx) {
  const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
  const name = settings.reports[idx].name;
  settings.reports.splice(idx, 1);
  localStorage.setItem('sekoujimu_settings', JSON.stringify(settings));
  renderReports();
  addLog(`レポート「${name}」を削除しました`, 'info');
}

// Load settings from localStorage
function loadSettings() {
  const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
  sfUserInput.value = settings.sfUser || '';
  sfPassInput.value = settings.sfPass || '';
  gftUserInput.value = settings.gftUser || '';
  gftPassInput.value = settings.gftPass || '';
  downloadPathInput.value = settings.downloadPath || '';
  renderReports();
}

// Save settings to localStorage
function saveSettings() {
  const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
  settings.sfUser = sfUserInput.value.trim();
  settings.sfPass = sfPassInput.value.trim();
  settings.gftUser = gftUserInput.value.trim();
  settings.gftPass = gftPassInput.value.trim();
  settings.downloadPath = downloadPathInput.value.trim();
  
  localStorage.setItem('sekoujimu_settings', JSON.stringify(settings));
  addLog('設定を保存しました。', 'success');
  settingsModal.classList.remove('active');
  renderReports();
}

settingsBtn.addEventListener('click', () => {
  loadSettings();
  settingsModal.classList.add('active');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

saveSettingsBtn.addEventListener('click', saveSettings);

// Settings Modal specific events
addReportBtn.addEventListener('click', addReport);
idReportList.addEventListener('click', (e) => {
  if (e.target.classList.contains('del-btn')) {
    const idx = parseInt(e.target.getAttribute('data-idx'));
    deleteReport(idx);
  }
});

// Main Grid specific events
reportGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('.report-btn');
  if (btn) {
    const url = btn.getAttribute('data-url');
    sfUrlInput.value = url;
    addLog(`レポートから起動を開始します: ${btn.textContent.trim().replace('📊', '').trim()}`, 'info');
    startAutomation();
  }
});

async function startAutomation() {
  const sfUrl = sfUrlInput.value.trim();
  const propertyName = propertyNameInput.value.trim();

  if (!sfUrl) {
    addLog('SalesforceのURLを入力してください', 'error');
    return;
  }

  startBtn.disabled = true;
  startBtn.innerText = '実行中...';
  
  // 予備としてログインボタンを使えるようにしておく
  loginCompleteBtn.disabled = false;
  loginCompleteBtn.classList.add('active');
  
  try {
    const settings = JSON.parse(localStorage.getItem('sekoujimu_settings') || '{}');
    
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sfUrl, 
        propertyName,
        config: settings
      })
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (err) {
    addLog(`サーバー接続エラー: ${err.message}`, 'error');
    startBtn.disabled = false;
    startBtn.innerText = '自動実行を開始する';
    loginCompleteBtn.disabled = true;
    loginCompleteBtn.classList.remove('active');
  }
}

// Initial load
loadSettings();

function addLog(message, type = 'info', timestamp = new Date().toLocaleTimeString()) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="time">[${timestamp}]</span> <span class="msg">${message}</span>`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // 特定のキーワードでボタンを光らせる（有効化）
  if (message.includes('MFA') || message.includes('ログイン認証')) {
    loginCompleteBtn.disabled = false;
    loginCompleteBtn.classList.add('active');
  }
}

// Connect to SSE with auto-reconnect
let eventSource;
function connectSSE() {
  if (eventSource) eventSource.close();
  
  eventSource = new EventSource('/events');
  
  eventSource.onopen = () => {
    console.log('SSE connection established');
  };

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
    setTimeout(connectSSE, 3000); // Reconnect after 3s
  };

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    addLog(data.message, data.type, data.timestamp);
    
    // Auto-fill property name from detected log
    if (data.message.includes('物件名を特定しました')) {
      const parts = data.message.split(':');
      if (parts.length > 1) {
          const detectedName = parts[1].trim();
          if (!propertyNameInput.value.trim() || propertyNameInput.value === '自動取得待ち...') {
              propertyNameInput.value = detectedName;
          }
      }
    }

    if (data.message.includes('ダウンロード機能を起動') || data.message.includes('成功しました')) {
      loginCompleteBtn.disabled = true;
      loginCompleteBtn.classList.remove('active');
    }
  };
}

connectSSE();

const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('user-display');

checkAuthState((user) => {
  if (user) {
    userDisplay.innerText = user.email;
  }
});

logoutBtn.addEventListener('click', () => {
  if (confirm('ログアウトしますか？')) {
    logout();
  }
});

startBtn.addEventListener('click', startAutomation);

loginCompleteBtn.addEventListener('click', async () => {
  loginCompleteBtn.disabled = true;
  loginCompleteBtn.classList.remove('active');
  loginCompleteBtn.innerText = '報告済み';
  
  try {
    await fetch('/api/login-complete', { method: 'POST' });
    addLog('ログイン完了を報告しました。自動実行を再開します。', 'info');
  } catch (err) {
    addLog(`エラー: ${err.message}`, 'error');
    loginCompleteBtn.disabled = false;
    loginCompleteBtn.classList.add('active');
    loginCompleteBtn.innerText = 'ログイン完了を報告';
  }
});
