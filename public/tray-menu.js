const closeBtn = document.getElementById('close-btn');
const openAtLoginBtn = document.getElementById('open-at-login-btn');
const openAtLoginDesc = document.getElementById('open-at-login-desc');
const openAtLoginSwitch = document.getElementById('open-at-login-switch');
const statusGrid = document.getElementById('status-grid');
const recentList = document.getElementById('recent-list');

let unsubscribeState = null;
let unsubscribeTheme = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

function renderStatusCards(state) {
  const status = state.status || {};
  const cards = [
    ['后台插件', `${formatNumber(status.backgroundPluginCount)} 个`],
    ['活跃 Host', `${formatNumber(status.activeHostCount)} 个`],
    ['任务运行中', `${formatNumber(status.runningTaskCount)} 个`],
    ['任务待执行', `${formatNumber(status.pendingTaskCount)} 个`],
  ];

  statusGrid.innerHTML = cards.map(([label, value]) => `
    <div class="status-card">
      <div class="status-label">${label}</div>
      <div class="status-value">${value}</div>
    </div>
  `).join('');
}

function renderRecent(state) {
  const list = Array.isArray(state.recentActions) ? state.recentActions : [];
  if (list.length === 0) {
    recentList.innerHTML = '<div class="empty-tip">暂无最近动作</div>';
    return;
  }

  recentList.innerHTML = list.map((item) => {
    const title = escapeHtml(item.title || '');
    const subtitle = escapeHtml(item.subtitle || '');
    const isPlugin = item.type === 'plugin' && item.pluginId && item.featureCode;
    if (isPlugin) {
      const pluginId = escapeAttr(item.pluginId);
      const featureCode = escapeAttr(item.featureCode);
      return `
        <button
          class="recent-item"
          type="button"
          data-action="runRecentPlugin"
          data-plugin-id="${pluginId}"
          data-feature-code="${featureCode}"
        >
          <div class="recent-title">${title}</div>
          <div class="recent-meta">${subtitle}</div>
        </button>
      `;
    }
    return `
      <div class="recent-item">
        <div class="recent-title">${title}</div>
        <div class="recent-meta">${subtitle}</div>
      </div>
    `;
  }).join('');
}

function renderOpenAtLogin(state) {
  const openAtLogin = state.openAtLogin || { supported: false, enabled: false };
  if (!openAtLogin.supported) {
    openAtLoginBtn.disabled = true;
    openAtLoginDesc.textContent = '当前系统暂不支持';
    openAtLoginSwitch.classList.remove('active');
    return;
  }
  openAtLoginBtn.disabled = false;
  openAtLoginDesc.textContent = openAtLogin.enabled ? '已启用' : '未启用';
  openAtLoginSwitch.classList.toggle('active', openAtLogin.enabled);
}

function render(state) {
  renderOpenAtLogin(state);
  renderStatusCards(state);
  renderRecent(state);
}

async function refreshState() {
  const state = await window.intools.trayMenu.getState();
  render(state);
}

async function runAction(action, payload) {
  const result = await window.intools.trayMenu.action(action, payload);
  if (!result || result.success !== true) {
    return;
  }
  if (result.state) {
    render(result.state);
  } else {
    await refreshState();
  }
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', normalized === 'dark');
  document.body.dataset.theme = normalized;
}

async function initTheme() {
  try {
    const current = await window.intools.theme.getActual();
    applyTheme(current);
  } catch {}

  unsubscribeTheme = window.intools.onThemeChange((theme) => {
    applyTheme(theme);
  });
}

closeBtn.addEventListener('click', () => {
  void window.intools.trayMenu.close();
});

openAtLoginBtn.addEventListener('click', () => {
  void runAction('toggleOpenAtLogin');
});

document.querySelectorAll('[data-action]').forEach((node) => {
  node.addEventListener('click', () => {
    const action = node.getAttribute('data-action');
    if (!action) return;
    void runAction(action);
  });
});

recentList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('button[data-action="runRecentPlugin"]');
  if (!button) return;
  const pluginId = button.getAttribute('data-plugin-id');
  const featureCode = button.getAttribute('data-feature-code');
  if (!pluginId || !featureCode) return;
  void runAction('runRecentPlugin', { pluginId, featureCode });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    void window.intools.trayMenu.close();
  }
});

unsubscribeState = window.intools.trayMenu.onState((state) => {
  render(state);
});

window.addEventListener('beforeunload', () => {
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }
  if (unsubscribeTheme) {
    unsubscribeTheme();
    unsubscribeTheme = null;
  }
});

void initTheme();
void refreshState();
