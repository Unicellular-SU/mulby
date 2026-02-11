import { BrowserWindow } from 'electron'

/**
 * 获取标题栏 CSS 样式
 */
function getTitleBarCSS(): string {
  return `
/* 标题栏容器 */
.it-pb-container {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  height: 36px !important;
  display: flex !important;
  align-items: center !important;
  background: #1e293b !important;
  border-bottom: 1px solid #334155 !important;
  z-index: 99999 !important;
  user-select: none !important;
  box-sizing: border-box !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  line-height: normal !important;
  padding: 0 !important;
  margin: 0 !important;
}

.it-pb-container * {
  box-sizing: border-box !important;
}

/* 拖拽区域 */
.it-pb-drag-region {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  -webkit-app-region: drag !important;
  z-index: 1 !important;
}

/* 标题文字 */
.it-pb-title {
  flex: 1 !important;
  text-align: center !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  color: #f1f5f9 !important;
  pointer-events: none !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  padding: 0 100px !important;
  z-index: 2 !important;
  margin: 0 !important;
  line-height: 36px !important;
}

/* 按钮容器 */
.it-pb-controls {
  position: absolute !important;
  right: 0 !important;
  top: 0 !important;
  height: 100% !important;
  display: flex !important;
  align-items: center !important;
  -webkit-app-region: no-drag !important;
  z-index: 10 !important;
}

/* 按钮基础样式 */
.it-pb-btn {
  width: 40px !important;
  height: 100% !important;
  min-width: 40px !important;
  min-height: 36px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  color: #94a3b8 !important;
  cursor: pointer !important;
  transition: background-color 0.15s, color 0.15s !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: 0 !important;
  -webkit-appearance: none !important;
  box-shadow: none !important;
}

/* 确保 SVG 尺寸正确 */
.it-pb-btn svg {
  width: 16px !important;
  height: 16px !important;
  min-width: 16px !important;
  min-height: 16px !important;
  /* display: block !important; CAUSES ISSUES WITH TOGGLING */
  fill: currentColor !important;
}

.it-pb-btn:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  color: #f1f5f9 !important;
}

/* 置顶按钮激活状态 */
.it-pb-btn.active {
  color: #3b82f6 !important;
}

.it-pb-btn.active:hover {
  color: #3b82f6 !important;
}

/* 关闭按钮特殊样式 */
.it-pb-btn-close:hover {
  background: #e81123 !important;
  color: white !important;
}

/* 浅色主题适配 */
.light .it-pb-container,
:root:not(.dark) .it-pb-container {
  background: #ffffff !important;
  border-bottom-color: #e2e8f0 !important;
}

.light .it-pb-title,
:root:not(.dark) .it-pb-title {
  color: #1e293b !important;
}

.light .it-pb-btn,
:root:not(.dark) .it-pb-btn {
  color: #64748b !important;
}

.light .it-pb-btn:hover,
:root:not(.dark) .it-pb-btn:hover {
  background: rgba(0, 0, 0, 0.06) !important;
  color: #1e293b !important;
}

/* 深色主题强制 */
.dark .it-pb-container {
  background: #1e293b !important;
  border-bottom-color: #334155 !important;
}

.dark .it-pb-title {
  color: #f1f5f9 !important;
}

.dark .it-pb-btn {
  color: #94a3b8 !important;
}

.dark .it-pb-btn:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  color: #f1f5f9 !important;
}

/* 内容区域偏移 */
body {
  padding-top: 36px !important;
  box-sizing: border-box !important;
}
`
}

/**
 * 获取标题栏 HTML
 */
function getTitleBarHTML(title: string): string {
  const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;')
  return `
<div id="mulby-titlebar" class="it-pb-container">
  <div class="it-pb-drag-region"></div>
  <div class="it-pb-title">${escapedTitle}</div>
  <div class="it-pb-controls">
    <button class="it-pb-btn" id="titlebar-pin" title="置顶">
      <svg viewBox="0 0 24 24" class="pin-icon">
        <path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" fill="currentColor"/>
      </svg>
      <svg viewBox="0 0 24 24" class="pin-active-icon" style="display:none">
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" fill="currentColor"/>
      </svg>
    </button>
    <button class="it-pb-btn" id="titlebar-reload" title="重新加载">
      <svg viewBox="0 0 24 24">
        <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
      </svg>
    </button>
    <button class="it-pb-btn" id="titlebar-minimize" title="最小化">
      <svg viewBox="0 0 24 24">
        <path d="M19 13H5v-2h14v2z" fill="currentColor"/>
      </svg>
    </button>
    <button class="it-pb-btn" id="titlebar-maximize" title="最大化">
      <svg viewBox="0 0 24 24" class="maximize-icon">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" fill="currentColor"/>
      </svg>
      <svg viewBox="0 0 24 24" class="restore-icon" style="display:none">
        <path d="M18 4H8c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h2c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-4 14H4v-8h10v8zm4-4h-2v-4c0-1.1-.9-2-2-2H8V6h10v8z" fill="currentColor"/>
      </svg>
    </button>
    <button class="it-pb-btn it-pb-btn-close" id="titlebar-close" title="关闭">
      <svg viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
      </svg>
    </button>
  </div>
</div>
`
}

/**
 * 获取标题栏 JavaScript 逻辑
 */
function getTitleBarJS(): string {
  return `
function initTitleBar() {
  var pinBtn = document.getElementById('titlebar-pin');
  var reloadBtn = document.getElementById('titlebar-reload');
  var minimizeBtn = document.getElementById('titlebar-minimize');
  var maximizeBtn = document.getElementById('titlebar-maximize');
  var closeBtn = document.getElementById('titlebar-close');
  var isAlwaysOnTop = false;

  // 检查元素是否存在，如果不存在则等待 DOM 重新生成
  if (!pinBtn || !reloadBtn || !minimizeBtn || !maximizeBtn || !closeBtn) {
    return;
  }

  // 初始化状态
  if (window.mulby && window.mulby.window.getState) {
    window.mulby.window.getState().then(function(state) {
      isAlwaysOnTop = state.isAlwaysOnTop;
      updatePinState();
      updateMaximizeIcon(state.isMaximized);
    });
  }

  // 置顶按钮
  pinBtn.addEventListener('click', function() {
    isAlwaysOnTop = !isAlwaysOnTop;
    window.mulby.window.setAlwaysOnTop(isAlwaysOnTop);
    updatePinState();
  });

  function updatePinState() {
    var pinIcon = pinBtn.querySelector('.pin-icon');
    var pinActiveIcon = pinBtn.querySelector('.pin-active-icon');
    if (isAlwaysOnTop) {
      pinBtn.classList.add('active');
      pinBtn.title = '取消置顶';
      pinIcon.style.display = 'none';
      pinActiveIcon.style.display = 'block';
    } else {
      pinBtn.classList.remove('active');
      pinBtn.title = '置顶';
      pinIcon.style.display = 'block';
      pinActiveIcon.style.display = 'none';
    }
  }

  // 重新加载按钮
  reloadBtn.addEventListener('click', function() {
    window.mulby.window.reload();
  });

  // 最小化按钮
  minimizeBtn.addEventListener('click', function() {
    window.mulby.window.minimize();
  });

  // 最大化/还原按钮
  maximizeBtn.addEventListener('click', function() {
    window.mulby.window.maximize();
  });

  function updateMaximizeIcon(isMaximized) {
    var maxIcon = maximizeBtn.querySelector('.maximize-icon');
    var restoreIcon = maximizeBtn.querySelector('.restore-icon');
    maxIcon.style.display = isMaximized ? 'none' : 'block';
    restoreIcon.style.display = isMaximized ? 'block' : 'none';
    maximizeBtn.title = isMaximized ? '还原' : '最大化';
  }

  // 监听窗口状态变化
  if (window.mulby && window.mulby.onWindowStateChange) {
    window.mulby.onWindowStateChange(function(state) {
      updateMaximizeIcon(state.isMaximized);
    });
  }

  // 关闭按钮
  closeBtn.addEventListener('click', function() {
    window.mulby.window.close();
  });

  // 初始化主题
  initTheme();
}

function initTheme() {
  if (window.mulby && window.mulby.theme && window.mulby.theme.getActual) {
    window.mulby.theme.getActual().then(function(theme) {
      applyTheme(theme);
    });
  }
  if (window.mulby && window.mulby.onThemeChange) {
    window.mulby.onThemeChange(function(theme) {
      applyTheme(theme);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
}

// 监听 body 变化，确保标题栏不被移除
var titleBarObserver = new MutationObserver(function(mutations) {
  if (!document.getElementById('mulby-titlebar')) {
    // 标题栏被移除了，重新注入
    var titleBarHTML = document.documentElement.dataset.titleBarHtml;
    if (titleBarHTML) {
       document.body.insertAdjacentHTML('afterbegin', titleBarHTML);
       initTitleBar();
    }
  }
});

// 开始监听
titleBarObserver.observe(document.body, { childList: true });
`
}

/**
 * 注入自定义标题栏到窗口
 */
export async function injectCustomTitleBar(
  win: BrowserWindow,
  title: string,
  theme: 'light' | 'dark' = 'dark'
): Promise<void> {
  const css = getTitleBarCSS()
  const html = getTitleBarHTML(title)
  const js = getTitleBarJS()

  // 注入 CSS
  await win.webContents.insertCSS(css)

  // 注入 HTML 和 JS，同时立即应用主题
  const escapedHtml = html.replace(/`/g, '\\`').replace(/\$/g, '\\$')
  await win.webContents.executeJavaScript(`
    (function() {
      // 保存 HTML 到 dataset 供 Observer 使用
      document.documentElement.dataset.titleBarHtml = \`${escapedHtml}\`;

      // 立即应用主题类
      document.documentElement.classList.toggle('dark', '${theme}' === 'dark');
      document.documentElement.classList.toggle('light', '${theme}' === 'light');

      ${js}
      var titleBarHTML = \`${escapedHtml}\`;
      
      // 检查是否已存在
      if (!document.getElementById('mulby-titlebar')) {
        document.body.insertAdjacentHTML('afterbegin', titleBarHTML);
        initTitleBar();
      }
    })();
  `)
}
