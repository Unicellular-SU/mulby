/**
 * 超级面板前端逻辑
 *
 * 纯 Vanilla JS 实现（与 tray-menu.js 模式一致）。
 *
 * 功能：
 * - 接收并渲染匹配结果列表
 * - 键盘导航（↑↓ 选择、Enter 执行、Esc 关闭）
 * - 点击执行
 * - 主题跟随
 */

const capturedTextEl = document.getElementById('captured-text');
const itemListEl = document.getElementById('item-list');

let currentItems = [];
let selectedIndex = 0;
let unsubscribeState = null;
let unsubscribeTheme = null;

// ==================== 渲染 ====================

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * 生成图标 HTML
 * - data-url / url → <img>
 * - emoji → 直接显示
 * - 无图标 → 首字母
 */
function renderIcon(icon, displayName) {
  if (icon && (icon.startsWith('data:') || icon.startsWith('http'))) {
    return `<img src="${escapeHtml(icon)}" alt="" />`;
  }
  if (icon && /^\p{Emoji}/u.test(icon)) {
    return escapeHtml(icon);
  }
  // 首字母占位
  const letter = (displayName || '?').charAt(0).toUpperCase();
  return `<span class="sp-icon-letter">${escapeHtml(letter)}</span>`;
}

function render(state) {
  // 更新选中文本预览
  if (state.capturedText && state.capturedText.trim()) {
    capturedTextEl.textContent = truncate(state.capturedText.trim(), 60);
    capturedTextEl.classList.remove('empty');
  } else {
    capturedTextEl.textContent = '未选中内容';
    capturedTextEl.classList.add('empty');
  }

  // 更新列表
  currentItems = Array.isArray(state.items) ? state.items : [];

  if (currentItems.length === 0) {
    itemListEl.innerHTML = '<div class="sp-empty">暂无匹配指令</div>';
    selectedIndex = 0;
    return;
  }

  selectedIndex = 0;

  itemListEl.innerHTML = currentItems.map((item, index) => {
    const isSelected = index === selectedIndex;
    const title = escapeHtml(truncate(item.featureExplain || item.featureCode, 40));
    const subtitle = escapeHtml(truncate(item.pluginDisplayName || item.pluginName, 30));
    const badge = escapeHtml(item.matchType || '');
    const icon = renderIcon(item.pluginIcon, item.pluginDisplayName);

    return `
      <button
        class="sp-item${isSelected ? ' selected' : ''}"
        type="button"
        data-index="${index}"
        data-plugin-id="${escapeHtml(item.pluginId)}"
        data-feature-code="${escapeHtml(item.featureCode)}"
        tabindex="${isSelected ? '0' : '-1'}"
      >
        <div class="sp-item-icon">${icon}</div>
        <div class="sp-item-content">
          <div class="sp-item-title">${title}</div>
          <div class="sp-item-subtitle">${subtitle}</div>
        </div>
        ${badge ? `<span class="sp-item-badge">${badge}</span>` : ''}
      </button>
    `;
  }).join('');
}

function updateSelection(newIndex) {
  if (currentItems.length === 0) return;
  const clampedIndex = Math.max(0, Math.min(newIndex, currentItems.length - 1));
  if (clampedIndex === selectedIndex) return;

  // 移除旧选中
  const oldEl = itemListEl.querySelector('.sp-item.selected');
  if (oldEl) {
    oldEl.classList.remove('selected');
    oldEl.tabIndex = -1;
  }

  // 设置新选中
  selectedIndex = clampedIndex;
  const newEl = itemListEl.querySelector(`[data-index="${selectedIndex}"]`);
  if (newEl) {
    newEl.classList.add('selected');
    newEl.tabIndex = 0;
    newEl.focus();
    // 确保可见
    newEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ==================== 动作 ====================

async function executeItem(index) {
  const item = currentItems[index];
  if (!item) return;
  await window.mulby.superPanel.action('execute', {
    pluginId: item.pluginId,
    featureCode: item.featureCode
  });
}

function closePanel() {
  void window.mulby.superPanel.close();
}

// ==================== 事件绑定 ====================

// 键盘导航
window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      updateSelection(selectedIndex - 1);
      break;
    case 'ArrowDown':
      event.preventDefault();
      updateSelection(selectedIndex + 1);
      break;
    case 'Enter':
      event.preventDefault();
      void executeItem(selectedIndex);
      break;
    case 'Escape':
      event.preventDefault();
      closePanel();
      break;
  }
});

// 点击列表项
itemListEl.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('.sp-item');
  if (!button) return;
  const index = parseInt(button.getAttribute('data-index') || '0', 10);
  void executeItem(index);
});

// 鼠标悬浮选中
itemListEl.addEventListener('mouseover', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('.sp-item');
  if (!button) return;
  const index = parseInt(button.getAttribute('data-index') || '0', 10);
  updateSelection(index);
});

// ==================== 主题 ====================

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', normalized === 'dark');
  document.body.dataset.theme = normalized;
}

async function initTheme() {
  try {
    const current = await window.mulby.theme.getActual();
    applyTheme(current);
  } catch { /* 忽略 */ }

  unsubscribeTheme = window.mulby.onThemeChange((theme) => {
    applyTheme(theme);
  });
}

// ==================== IPC 监听 ====================

// 接收主进程推送的面板状态
unsubscribeState = window.mulby.superPanel.onState((state) => {
  render(state);
});

// 初始加载
async function init() {
  await initTheme();
  const state = await window.mulby.superPanel.getState();
  render(state);
}

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

void init();
