import { BrowserWindow } from 'electron'

/**
 * 获取标题栏 CSS 样式
 */
function getTitleBarCSS(): string {
  return `
/* 标题栏容器 */
.intools-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  align-items: center;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  z-index: 99999;
  user-select: none;
}

/* 拖拽区域 */
.titlebar-drag-region {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  -webkit-app-region: drag;
}

/* 标题文字 */
.titlebar-title {
  flex: 1;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: #f1f5f9;
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 100px;
}

/* 按钮容器 */
.titlebar-controls {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

/* 按钮基础样式 */
.titlebar-btn {
  width: 40px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}

/* 置顶按钮激活状态 */
.titlebar-btn.active {
  color: #3b82f6;
}

.titlebar-btn.active:hover {
  color: #3b82f6;
}

/* 关闭按钮特殊样式 */
.titlebar-btn-close:hover {
  background: #e81123;
  color: white;
}

/* 浅色主题适配 */
.light .intools-titlebar,
:root:not(.dark) .intools-titlebar {
  background: #f8fafc;
  border-bottom-color: #e2e8f0;
}

.light .titlebar-title,
:root:not(.dark) .titlebar-title {
  color: #1e293b;
}

.light .titlebar-btn,
:root:not(.dark) .titlebar-btn {
  color: #64748b;
}

.light .titlebar-btn:hover,
:root:not(.dark) .titlebar-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1e293b;
}

/* 深色主题强制 */
.dark .intools-titlebar {
  background: #1e293b;
  border-bottom-color: #334155;
}

.dark .titlebar-title {
  color: #f1f5f9;
}

.dark .titlebar-btn {
  color: #94a3b8;
}

.dark .titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}

/* 内容区域偏移 */
body {
  padding-top: 36px !important;
  box-sizing: border-box;
}
`
}

/**
 * 获取标题栏 HTML
 */
function getTitleBarHTML(title: string): string {
  const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;')
  return `
<div id="intools-titlebar" class="intools-titlebar">
  <div class="titlebar-drag-region"></div>
  <div class="titlebar-title">${escapedTitle}</div>
  <div class="titlebar-controls">
    <button class="titlebar-btn" id="titlebar-pin" title="置顶">
      <svg viewBox="0 0 24 24" width="14" height="14" class="pin-icon">
        <path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" fill="currentColor"/>
      </svg>
      <svg viewBox="0 0 24 24" width="14" height="14" class="pin-active-icon" style="display:none">
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" fill="currentColor"/>
      </svg>
    </button>
    <button class="titlebar-btn" id="titlebar-reload" title="重新加载">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
      </svg>
    </button>
    <button class="titlebar-btn" id="titlebar-minimize" title="最小化">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M19 13H5v-2h14v2z" fill="currentColor"/>
      </svg>
    </button>
    <button class="titlebar-btn" id="titlebar-maximize" title="最大化">
      <svg viewBox="0 0 24 24" width="14" height="14" class="maximize-icon">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" fill="currentColor"/>
      </svg>
      <svg viewBox="0 0 24 24" width="14" height="14" class="restore-icon" style="display:none">
        <path d="M18 4H8c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h2c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-4 14H4v-8h10v8zm4-4h-2v-4c0-1.1-.9-2-2-2H8V6h10v8z" fill="currentColor"/>
      </svg>
    </button>
    <button class="titlebar-btn titlebar-btn-close" id="titlebar-close" title="关闭">
      <svg viewBox="0 0 24 24" width="14" height="14">
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

  // 初始化状态
  if (window.intools && window.intools.window.getState) {
    window.intools.window.getState().then(function(state) {
      isAlwaysOnTop = state.isAlwaysOnTop;
      updatePinState();
      updateMaximizeIcon(state.isMaximized);
    });
  }

  // 置顶按钮
  pinBtn.addEventListener('click', function() {
    isAlwaysOnTop = !isAlwaysOnTop;
    window.intools.window.setAlwaysOnTop(isAlwaysOnTop);
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
    window.intools.window.reload();
  });

  // 最小化按钮
  minimizeBtn.addEventListener('click', function() {
    window.intools.window.minimize();
  });

  // 最大化/还原按钮
  maximizeBtn.addEventListener('click', function() {
    window.intools.window.maximize();
  });

  function updateMaximizeIcon(isMaximized) {
    var maxIcon = maximizeBtn.querySelector('.maximize-icon');
    var restoreIcon = maximizeBtn.querySelector('.restore-icon');
    maxIcon.style.display = isMaximized ? 'none' : 'block';
    restoreIcon.style.display = isMaximized ? 'block' : 'none';
    maximizeBtn.title = isMaximized ? '还原' : '最大化';
  }

  // 监听窗口状态变化
  if (window.intools && window.intools.onWindowStateChange) {
    window.intools.onWindowStateChange(function(state) {
      updateMaximizeIcon(state.isMaximized);
    });
  }

  // 关闭按钮
  closeBtn.addEventListener('click', function() {
    window.intools.window.close();
  });

  // 初始化主题
  initTheme();
}

function initTheme() {
  if (window.intools && window.intools.theme && window.intools.theme.getActual) {
    window.intools.theme.getActual().then(function(theme) {
      applyTheme(theme);
    });
  }
  if (window.intools && window.intools.onThemeChange) {
    window.intools.onThemeChange(function(theme) {
      applyTheme(theme);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
}
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
      // 立即应用主题类
      document.documentElement.classList.toggle('dark', '${theme}' === 'dark');
      document.documentElement.classList.toggle('light', '${theme}' === 'light');

      ${js}
      var titleBarHTML = \`${escapedHtml}\`;
      document.body.insertAdjacentHTML('afterbegin', titleBarHTML);
      initTitleBar();
    })();
  `)
}
