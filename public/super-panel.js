/**
 * 超级面板前端逻辑
 *
 * 纯 Vanilla JS 实现（与 tray-menu.js 模式一致）。
 *
 * 功能：
 * - 双模式渲染：match（匹配结果）/ pinned（固定列表）
 * - 面板内二次搜索（实时过滤）
 * - 即时翻译卡片（异步加载/显示/点击复制）
 * - 右键菜单（固定/取消固定）
 * - 键盘导航（↑↓ 选择、Enter 执行、Esc 关闭、Tab 切焦点）
 * - 主题跟随
 */

const capturedTextEl = document.getElementById('captured-text');
const itemListEl = document.getElementById('item-list');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const translationCard = document.getElementById('translation-card');
const translationText = document.getElementById('translation-text');
const translationCopyBtn = document.getElementById('translation-copy-btn');

let currentItems = [];
let currentPinnedItems = [];
let currentMode = 'match';
let selectedIndex = 0;
let unsubscribeState = null;
let unsubscribeTheme = null;
// 初始匹配结果数量（用于搜索框可见性判断，不随过滤变化）
let originalItemCount = 0;
// 搜索框是否有活跃查询
let isSearchActive = false;

// ==================== 工具函数 ====================

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

// ==================== 渲染 ====================

function render(state) {
  currentMode = state.mode || 'match';

  // 更新选中文本预览
  if (state.capturedText && state.capturedText.trim()) {
    capturedTextEl.textContent = truncate(state.capturedText.trim(), 60);
    capturedTextEl.classList.remove('empty');
  } else {
    capturedTextEl.textContent = '未选中内容';
    capturedTextEl.classList.add('empty');
  }

  if (currentMode === 'match') {
    renderMatchMode(state);
  } else {
    renderPinnedMode(state);
  }

  // 翻译卡片
  renderTranslation(state.translation);
}

function renderMatchMode(state) {
  const prevItems = currentItems;
  currentItems = Array.isArray(state.items) ? state.items : [];
  currentPinnedItems = [];

  // 非搜索状态下更新初始结果数量（搜索期间 items 是过滤后的子集，不应覆盖）
  if (!isSearchActive) {
    originalItemCount = currentItems.length;
  }

  // 搜索框可见性：基于初始结果数量或有活跃查询
  if (originalItemCount > 1 || isSearchActive) {
    searchBar.style.display = '';
  } else {
    searchBar.style.display = 'none';
  }

  if (currentItems.length === 0) {
    itemListEl.innerHTML = '<div class="sp-empty">暂无匹配指令</div>';
    selectedIndex = 0;
    return;
  }

  // 仅在列表内容变化时重置选中（翻译推送等非列表更新不重置）
  const listChanged = prevItems.length !== currentItems.length ||
    currentItems.some((item, i) => !prevItems[i] || prevItems[i].id !== item.id);
  if (listChanged) {
    selectedIndex = 0;
  } else {
    // 确保 selectedIndex 不越界
    selectedIndex = Math.min(selectedIndex, currentItems.length - 1);
  }

  itemListEl.innerHTML = currentItems.map((item, index) => renderItemHtml(item, index, false)).join('');
}

function renderPinnedMode(state) {
  currentPinnedItems = Array.isArray(state.pinnedItems) ? state.pinnedItems : [];
  currentItems = [];

  // 隐藏搜索框和翻译卡片
  searchBar.style.display = 'none';
  translationCard.style.display = 'none';

  if (currentPinnedItems.length === 0) {
    itemListEl.innerHTML = `
      <div class="sp-empty">
        <div class="sp-pinned-empty-icon">📌</div>
        <div>还没有固定的功能</div>
        <div class="sp-pinned-empty-hint">选中文本后，右键匹配结果可固定到此处</div>
      </div>
    `;
    selectedIndex = 0;
    return;
  }

  selectedIndex = 0;
  itemListEl.innerHTML = currentPinnedItems.map((item, index) => {
    const isSelected = index === selectedIndex;
    const title = escapeHtml(truncate(item.displayName, 40));
    const icon = renderIcon(item.pluginIcon, item.displayName);
    return `
      <button
        class="sp-item${isSelected ? ' selected' : ''}"
        type="button"
        data-index="${index}"
        data-plugin-id="${escapeHtml(item.pluginId)}"
        data-feature-code="${escapeHtml(item.featureCode)}"
        data-pinned="true"
        tabindex="${isSelected ? '0' : '-1'}"
      >
        <div class="sp-item-icon">${icon}</div>
        <div class="sp-item-content">
          <div class="sp-item-title">${title}</div>
          <div class="sp-item-subtitle">${escapeHtml(item.pluginId)}</div>
        </div>
        <span class="sp-item-badge sp-badge-pinned">📌</span>
      </button>
    `;
  }).join('');
}

function renderItemHtml(item, index, _isPinned) {
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
      data-display-name="${escapeHtml(item.featureExplain || item.featureCode)}"
      data-plugin-icon="${escapeHtml(item.pluginIcon || '')}"
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
}

function renderTranslation(translation) {
  if (!translation) {
    translationCard.style.display = 'none';
    return;
  }

  translationCard.style.display = '';

  if (translation.loading) {
    translationText.innerHTML = '<span class="sp-translation-loading">翻译中…</span>';
    translationText.classList.remove('expanded');
    translationText.classList.add('collapsed');
    translationCopyBtn.style.display = 'none';
  } else if (translation.error) {
    translationText.innerHTML = `<span class="sp-translation-error">${escapeHtml(translation.error)}</span>`;
    translationText.classList.remove('expanded');
    translationText.classList.add('collapsed');
    translationCopyBtn.style.display = 'none';
  } else if (translation.text) {
    translationText.textContent = translation.text;
    if (translation.expanded) {
      translationText.classList.remove('collapsed');
      translationText.classList.add('expanded');
    } else {
      translationText.classList.remove('expanded');
      translationText.classList.add('collapsed');
    }
    translationCopyBtn.style.display = '';
  } else {
    translationCard.style.display = 'none';
  }
}

// ==================== 选中状态 ====================

function updateSelection(newIndex) {
  const total = currentMode === 'pinned' ? currentPinnedItems.length : currentItems.length;
  if (total === 0) return;
  const clampedIndex = Math.max(0, Math.min(newIndex, total - 1));
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
  if (currentMode === 'pinned') {
    const item = currentPinnedItems[index];
    if (!item) return;
    await window.mulby.superPanel.action('execute', {
      pluginId: item.pluginId,
      featureCode: item.featureCode
    });
  } else {
    const item = currentItems[index];
    if (!item) return;
    await window.mulby.superPanel.action('execute', {
      pluginId: item.pluginId,
      featureCode: item.featureCode
    });
  }
}

function closePanel() {
  searchInput.value = '';
  isSearchActive = false;
  originalItemCount = 0;
  void window.mulby.superPanel.close();
}

// ==================== 二次搜索 ====================

let searchDebounceTimer = null;

function handleSearchInput() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    const query = searchInput.value.trim();
    isSearchActive = query.length > 0;
    void window.mulby.superPanel.action('search', { query });
  }, 100);
}

searchInput.addEventListener('input', handleSearchInput);

// ==================== 右键菜单 ====================

itemListEl.addEventListener('contextmenu', async (event) => {
  event.preventDefault();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('.sp-item');
  if (!button) return;

  const pluginId = button.getAttribute('data-plugin-id') || '';
  const featureCode = button.getAttribute('data-feature-code') || '';
  const isPinned = button.getAttribute('data-pinned') === 'true';

  if (!pluginId || !featureCode) return;

  if (isPinned || currentMode === 'pinned') {
    // 已固定 → 取消固定
    const items = [{ id: 'unpin', label: '取消固定' }];
    const selected = await window.mulby.menu.showContextMenu(items);
    if (selected === 'unpin') {
      await window.mulby.superPanel.action('unpin', { pluginId, featureCode });
    }
  } else {
    // 未固定 → 固定
    const displayName = button.getAttribute('data-display-name') || featureCode;
    const pluginIcon = button.getAttribute('data-plugin-icon') || '';
    const items = [{ id: 'pin', label: '固定到面板' }];
    const selected = await window.mulby.menu.showContextMenu(items);
    if (selected === 'pin') {
      await window.mulby.superPanel.action('pin', { pluginId, featureCode, displayName, pluginIcon });
    }
  }
});

// ==================== 翻译卡片展开/折叠与复制 ====================

translationText.addEventListener('click', () => {
  if (translationText.classList.contains('collapsed')) {
    translationText.classList.remove('collapsed');
    translationText.classList.add('expanded');
    const height = translationCard.offsetHeight;
    void window.mulby.superPanel.action('translationToggle', { expanded: true, height });
  } else {
    translationText.classList.remove('expanded');
    translationText.classList.add('collapsed');
    void window.mulby.superPanel.action('translationToggle', { expanded: false });
  }
});

translationCopyBtn.addEventListener('click', () => {
  const text = translationText.textContent;
  if (!text) return;
  // 通过主进程剪贴板 API 复制（避免 panel 窗口 navigator.clipboard 权限问题）
  window.mulby.superPanel.action('copyTranslation', { text }).then((result) => {
    if (result && result.success) {
      const originalHTML = translationCopyBtn.innerHTML;
      // 显示勾选图标
      translationCopyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981;"><path d="M13.5 4.5L6.5 11.5L2.5 7.5"></path></svg>`;
      setTimeout(() => {
        translationCopyBtn.innerHTML = originalHTML;
      }, 1200);
    }
  }).catch(() => { /* 忽略 */ });
});

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
      if (document.activeElement && document.activeElement.tagName === 'BUTTON' && document.activeElement.closest('.sp-translation')) {
        // 放行回车，让浏览器原生触发复制按钮等内联元素的点击
        break;
      }
      event.preventDefault();
      void executeItem(selectedIndex);
      break;
    case 'Escape':
      event.preventDefault();
      closePanel();
      break;
    case 'Tab':
      // Tab 在搜索框和列表之间切换
      if (searchBar.style.display !== 'none') {
        event.preventDefault();
        if (document.activeElement === searchInput) {
          // 聚焦到列表
          const firstItem = itemListEl.querySelector('.sp-item.selected') || itemListEl.querySelector('.sp-item');
          if (firstItem) firstItem.focus();
        } else {
          searchInput.focus();
        }
      }
      break;
    default:
      // 可打印字符 → 自动聚焦搜索框
      if (
        searchBar.style.display !== 'none' &&
        document.activeElement !== searchInput &&
        event.key.length === 1 &&
        !event.ctrlKey && !event.metaKey && !event.altKey
      ) {
        searchInput.focus();
        // 不 preventDefault，让字符正常输入
      }
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
