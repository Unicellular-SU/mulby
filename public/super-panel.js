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
// 当前是否有捕获的文本（用于决定“复制捕获内容”动作是否可用）
let hasCapturedText = false;

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

/**
 * 渲染当前应用上下文标签（显示在 header 区域）
 */
function renderActiveApp(activeApp) {
  let el = document.getElementById('active-app-tag');
  if (!activeApp || !activeApp.app) {
    if (el) el.style.display = 'none';
    return;
  }
  if (!el) {
    el = document.createElement('span');
    el.id = 'active-app-tag';
    el.className = 'sp-active-app';
    // 插入到 captured-text 同级
    const captured = document.querySelector('.sp-captured');
    if (captured) captured.appendChild(el);
  }
  el.textContent = activeApp.app;
  el.style.display = '';
}

// ==================== 渲染 ====================

function render(state) {
  currentMode = state.mode || 'match';

  // 更新选中文本预览
  if (state.capturedText && state.capturedText.trim()) {
    hasCapturedText = true;
    capturedTextEl.textContent = truncate(state.capturedText.trim(), 60);
    capturedTextEl.classList.remove('empty');
  } else {
    hasCapturedText = false;
    capturedTextEl.textContent = '未选中内容';
    capturedTextEl.classList.add('empty');
  }

  // 显示当前应用上下文标签
  renderActiveApp(state.activeApp);

  // 重新渲染前重置内联动作面板状态（防止 pushState 重构 DOM 后状态残留）
  resetActionPanelState();

  if (currentMode === 'match') {
    renderMatchMode(state);
  } else {
    renderPinnedMode(state);
  }

  // 翻译卡片
  renderTranslation(state.translation);

  // 等 DOM 布局完成后，将实际高度同步给主进程以校正窗口尺寸
  requestAnimationFrame(() => notifyHeightChange());
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
  currentItems = [];

  // 隐藏搜索框和翻译卡片
  searchBar.style.display = 'none';
  translationCard.style.display = 'none';

  // 优先使用 pinnedGroups（v2），回退到 pinnedItems（v1 兼容）
  const groups = Array.isArray(state.pinnedGroups) ? state.pinnedGroups : null;

  if (groups) {
    // v2 分组渲染
    const allItems = groups.flatMap(g => g.items);
    currentPinnedItems = allItems;

    if (allItems.length === 0) {
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
    let globalIndex = 0;
    let html = '';
    const showHeaders = groups.length > 1 || groups.some(g => g.boundApp);

    for (const group of groups) {
      if (group.items.length === 0 && !showHeaders) continue;

      // 分组标题（仅多分组或有绑定应用时显示）
      if (showHeaders) {
        const appLabel = group.boundApp
          ? `<span class="sp-group-app">${escapeHtml(group.boundApp)}</span>`
          : '';
        html += `<div class="sp-group-header">
          <span class="sp-group-name">${escapeHtml(group.name)}</span>
          ${appLabel}
        </div>`;
      }

      for (const item of group.items) {
        const isSelected = globalIndex === selectedIndex;
        const title = escapeHtml(truncate(item.displayName, 40));
        const icon = renderIcon(item.pluginIcon, item.displayName);
        html += `
          <button
            class="sp-item${isSelected ? ' selected' : ''}"
            type="button"
            data-index="${globalIndex}"
            data-plugin-id="${escapeHtml(item.pluginId)}"
            data-feature-code="${escapeHtml(item.featureCode)}"
            data-pinned="true"
            data-group-id="${escapeHtml(group.id)}"
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
        globalIndex++;
      }
    }

    itemListEl.innerHTML = html;
  } else {
    // v1 兼容回退
    currentPinnedItems = Array.isArray(state.pinnedItems) ? state.pinnedItems : [];

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
}

function renderItemHtml(item, index, _isPinned) {
  const isSelected = index === selectedIndex;
  const title = escapeHtml(truncate(item.featureExplain || item.featureCode, 40));
  const subtitle = escapeHtml(truncate(item.pluginDisplayName || item.pluginName, 30));
  const badge = escapeHtml(item.matchType || '');
  const icon = renderIcon(item.pluginIcon, item.pluginDisplayName);
  const contextLabel = item.contextBoost > 0
    ? '<span class="sp-item-context">为此应用推荐</span>'
    : '';

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
        <div class="sp-item-title">${title}${contextLabel}</div>
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

// ==================== 内联动作面板 (Action Panel) ====================

let actionPanelVisible = false;
let actionSelectedIndex = 0;
let actionTargetIndex = -1; // 当前动作面板对应的列表项索引
let currentActions = [];

/** 获取当前选中项的可用动作列表 */
function getActionsForItem(index) {
  const isPinned = currentMode === 'pinned';
  const item = isPinned ? currentPinnedItems[index] : currentItems[index];
  if (!item) return [];

  const actions = [
    { id: 'execute', label: '执行', key: '↵', shortcut: 'Enter' }
  ];

  if (isPinned) {
    actions.push({ id: 'unpin', label: '取消固定', key: 'P', shortcut: 'p' });
  } else {
    actions.push({ id: 'pin', label: '固定到面板', key: 'P', shortcut: 'p' });
  }

  if (isPinned) {
    // 固定模式：提供分组管理
    actions.push(
      { id: 'separator' },
      { id: 'moveToGroup', label: '移动到分组…', key: 'G', shortcut: 'g' }
    );
    // 仅当有捕获文本时才显示“复制捕获内容”
    if (hasCapturedText) {
      actions.push({ id: 'copyInput', label: '复制捕获内容', key: 'C', shortcut: 'c' });
    }
    actions.push(
      { id: 'separator' },
      { id: 'viewPlugin', label: '查看插件', key: 'I', shortcut: 'i' }
    );
  } else {
    // 匹配模式：提供禁用推荐
    actions.push({ id: 'separator' });
    // 仅当有捕获文本时才显示"复制捕获内容"
    if (hasCapturedText) {
      actions.push({ id: 'copyInput', label: '复制捕获内容', key: 'C', shortcut: 'c' });
    }
    actions.push(
      { id: 'disableRecommend', label: '禁用此推荐', key: 'D', shortcut: 'd' },
      { id: 'separator' },
      { id: 'viewPlugin', label: '查看插件', key: 'I', shortcut: 'i' }
    );
  }

  return actions;
}

/** 显示内联动作面板 */
function showInlineActions(index) {
  // 先关闭已有的
  hideInlineActions();

  const actions = getActionsForItem(index);
  if (actions.length === 0) return;

  actionTargetIndex = index;
  currentActions = actions;
  actionSelectedIndex = 0;
  actionPanelVisible = true;

  // 找到对应的列表项元素
  const itemEl = itemListEl.querySelector(`[data-index="${index}"]`);
  if (!itemEl) return;

  // 构建动作列表 HTML
  const actionableActions = actions.filter(a => a.id !== 'separator');
  let html = '<div class="sp-inline-actions"><div class="sp-actions-inner">';
  let actionIdx = 0;
  for (const action of actions) {
    if (action.id === 'separator') {
      html += '<div class="sp-action-separator"></div>';
    } else {
      const isSelected = actionIdx === actionSelectedIndex;
      html += `
        <button class="sp-action-item${isSelected ? ' action-selected' : ''}"
                type="button"
                data-action-id="${action.id}"
                data-action-index="${actionIdx}">
          <span class="sp-action-label">${escapeHtml(action.label)}</span>
          <kbd>${action.key}</kbd>
        </button>
      `;
      actionIdx++;
    }
  }
  html += '</div></div>';

  // 插入到列表项后面
  itemEl.insertAdjacentHTML('afterend', html);

  // 等待展开动画结束后再测量高度，避免动画中测到折叠态高度
  requestAnimationFrame(() => {
    const actionsEl = itemListEl.querySelector('.sp-inline-actions');
    if (actionsEl) {
      actionsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // 监听动画结束后再通知主进程调整窗口高度
      const onAnimEnd = () => {
        actionsEl.removeEventListener('animationend', onAnimEnd);
        notifyHeightChange();
      };
      actionsEl.addEventListener('animationend', onAnimEnd);
      // 兜底：动画可能已结束或被跳过（如 prefers-reduced-motion），200ms 后强制测量
      setTimeout(() => {
        actionsEl.removeEventListener('animationend', onAnimEnd);
        notifyHeightChange();
      }, 200);
    } else {
      notifyHeightChange();
    }
  });
}

/** 重置动作面板状态（纯状态，不操作 DOM）— 在 render() 重建 DOM 前调用 */
function resetActionPanelState() {
  actionPanelVisible = false;
  actionTargetIndex = -1;
  currentActions = [];
  actionSelectedIndex = 0;
}

/** 隐藏内联动作面板 */
function hideInlineActions() {
  if (!actionPanelVisible) return;
  const existing = itemListEl.querySelector('.sp-inline-actions');
  if (existing) existing.remove();
  resetActionPanelState();

  // 恢复窗口高度
  requestAnimationFrame(() => notifyHeightChange());
}

/** 切换动作面板 */
function toggleInlineActions() {
  if (actionPanelVisible && actionTargetIndex === selectedIndex) {
    hideInlineActions();
  } else {
    showInlineActions(selectedIndex);
  }
}

/** 动作面板内的箭头键导航 */
function updateActionSelection(newIndex) {
  const actionableActions = currentActions.filter(a => a.id !== 'separator');
  if (actionableActions.length === 0) return;
  const clamped = Math.max(0, Math.min(newIndex, actionableActions.length - 1));
  if (clamped === actionSelectedIndex) return;

  // 移除旧选中
  const oldEl = itemListEl.querySelector('.sp-action-item.action-selected');
  if (oldEl) oldEl.classList.remove('action-selected');

  actionSelectedIndex = clamped;
  const newEl = itemListEl.querySelector(`[data-action-index="${actionSelectedIndex}"]`);
  if (newEl) {
    newEl.classList.add('action-selected');
    newEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** 执行动作 */
async function executeAction(actionId) {
  const isPinned = currentMode === 'pinned';
  const item = isPinned ? currentPinnedItems[actionTargetIndex] : currentItems[actionTargetIndex];
  if (!item) return;

  // 保存目标索引（hideInlineActions 会重置 actionTargetIndex 为 -1）
  const targetIndex = actionTargetIndex;
  hideInlineActions();

  switch (actionId) {
    case 'execute':
      await executeItem(targetIndex);
      break;

    case 'pin': {
      const displayName = item.featureExplain || item.featureCode || item.displayName || '';
      const pluginIcon = item.pluginIcon || '';
      await window.mulby.superPanel.action('pin', {
        pluginId: item.pluginId,
        featureCode: item.featureCode,
        displayName,
        pluginIcon
      });
      break;
    }

    case 'unpin':
      await window.mulby.superPanel.action('unpin', {
        pluginId: item.pluginId,
        featureCode: item.featureCode
      });
      break;

    case 'moveToGroup': {
      // 获取分组列表并显示简易选择菜单
      const result = await window.mulby.superPanel.action('getGroups', {});
      if (result && result.success && result.data && result.data.groups) {
        const groups = result.data.groups;
        const menuItems = groups.map(g => ({
          id: g.id,
          label: g.name + (g.boundApp ? ` (${g.boundApp})` : '') + ` · ${g.itemCount}项`
        }));
        menuItems.push({ id: '__new__', label: '+ 新建分组…' });
        await window.mulby.superPanel.setIgnoreBlur(true);
        let selected;
        try {
          selected = await window.mulby.menu.showContextMenu(menuItems);
        } finally {
          await window.mulby.superPanel.setIgnoreBlur(false);
        }
        if (selected === '__new__') {
          const newGroupResult = await window.mulby.superPanel.action('createGroup', { name: '新分组' });
          if (newGroupResult && newGroupResult.success && newGroupResult.data) {
            await window.mulby.superPanel.action('moveItemToGroup', {
              pluginId: item.pluginId,
              featureCode: item.featureCode,
              targetGroupId: newGroupResult.data.groupId
            });
          }
        } else if (selected) {
          await window.mulby.superPanel.action('moveItemToGroup', {
            pluginId: item.pluginId,
            featureCode: item.featureCode,
            targetGroupId: selected
          });
        }
      }
      break;
    }

    case 'copyInput':
      await window.mulby.superPanel.action('copyInput', {});
      break;

    case 'disableRecommend':
      await window.mulby.superPanel.action('disableRecommend', {
        pluginId: item.pluginId,
        featureCode: item.featureCode
      });
      break;

    case 'viewPlugin':
      await window.mulby.superPanel.action('viewPlugin', {
        pluginId: item.pluginId
      });
      break;
  }
}

/** 通知主进程调整窗口高度（渲染后及动作面板切换时调用） */
let lastNotifiedHeight = 0;

function notifyHeightChange() {
  try {
    const header = document.querySelector('.sp-header');
    const translation = document.querySelector('.sp-translation');
    const footer = document.querySelector('.sp-footer');
    const list = document.querySelector('.sp-list');
    // body padding 6×2 = 12, .sp-shell border 1×2 = 2 → 14
    let contentHeight = 14;
    if (header) contentHeight += header.offsetHeight;
    if (translation && translation.style.display !== 'none') contentHeight += translation.scrollHeight + 6;
    if (list) {
      let listContentHeight = 12; // .sp-list padding 6×2
      for (const child of list.children) {
        listContentHeight += child.offsetHeight;
      }
      contentHeight += listContentHeight;
    }
    if (footer) contentHeight += footer.offsetHeight;
    // Only send IPC when height actually changed (>2px tolerance)
    if (contentHeight > 50 && Math.abs(contentHeight - lastNotifiedHeight) > 2) {
      lastNotifiedHeight = contentHeight;
      window.mulby.superPanel.action('adjustHeight', { height: contentHeight });
    }
  } catch { /* 忽略 */ }
}

// 动作面板点击事件委托
itemListEl.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  // 点击动作项
  const actionBtn = target.closest('.sp-action-item');
  if (actionBtn) {
    event.stopPropagation();
    const actionId = actionBtn.getAttribute('data-action-id');
    if (actionId) void executeAction(actionId);
    return;
  }

  // 点击列表项（双击执行，单击切换动作面板已在内联处理）
  const button = target.closest('.sp-item');
  if (!button) return;
  const index = parseInt(button.getAttribute('data-index') || '0', 10);
  // 如果动作面板开着且点击了其他项，先关闭
  if (actionPanelVisible) {
    hideInlineActions();
  }
  void executeItem(index);
});

// 右键触发内联动作面板（替代旧的原生菜单）
// 已展开时再次右键同一项 → 收起；切换到其他项 → 展开新项
itemListEl.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest('.sp-item');
  if (!button) return;

  const index = parseInt(button.getAttribute('data-index') || '0', 10);
  updateSelection(index);
  // 若面板已展开且对应同一列表项，则收起；否则展开
  if (actionPanelVisible && actionTargetIndex === index) {
    hideInlineActions();
  } else {
    showInlineActions(index);
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
  // === 动作面板打开时，接管键盘 ===
  if (actionPanelVisible) {
    // ⌘K / Ctrl+K 再次触发时收起动作面板
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      hideInlineActions();
      return;
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        updateActionSelection(actionSelectedIndex - 1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        updateActionSelection(actionSelectedIndex + 1);
        return;
      case 'Enter': {
        event.preventDefault();
        const actionableActions = currentActions.filter(a => a.id !== 'separator');
        const action = actionableActions[actionSelectedIndex];
        if (action) void executeAction(action.id);
        return;
      }
      case 'Escape':
        event.preventDefault();
        hideInlineActions();
        return;
      default: {
        // 单字母快捷键
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const actionableActions = currentActions.filter(a => a.id !== 'separator');
          const match = actionableActions.find(a => a.shortcut === event.key.toLowerCase());
          if (match) {
            event.preventDefault();
            void executeAction(match.id);
            return;
          }
        }
        break;
      }
    }
    // 动作面板打开时，拦截所有未处理的按键，避免字符漏进搜索框
    event.preventDefault();
    return; // 屏蔽其他键盘事件
  }

  // === Cmd/Ctrl + K → 切换动作面板 ===
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    toggleInlineActions();
    return;
  }

  // === 常规键盘导航 ===
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
      }
      break;
  }
});

// 鼠标悬浮选中
itemListEl.addEventListener('mouseover', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  // 忽略动作项的悬浮
  if (target.closest('.sp-inline-actions')) return;
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
  lastNotifiedHeight = 0; // 新状态到达时重置，确保下次渲染必定校正高度
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
