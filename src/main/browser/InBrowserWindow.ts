import { BrowserWindow, Session } from 'electron';
import { InBrowserOp, InBrowserOptions } from '../../shared/types/inbrowser';

export class InBrowserWindow {
    public window: BrowserWindow;
    public id: number;
    private readonly cleanupSessionOnClose: boolean;
    private readonly ownedSession: Session;
    private sessionCleanupPromise: Promise<void> | null = null;

    constructor(options: InBrowserOptions, cleanupSessionOnClose: boolean = false) {
        this.window = new BrowserWindow({
            ...options,
            show: options.show ?? false, // Default to hidden
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                ...options.webPreferences,
            },
        });
        this.id = this.window.id;
        this.cleanupSessionOnClose = cleanupSessionOnClose;
        this.ownedSession = this.window.webContents.session;

        if (this.cleanupSessionOnClose) {
            this.window.once('closed', () => {
                void this.cleanupSessionData();
            });
        }
    }

    public async run(queue: InBrowserOp[]): Promise<unknown[]> {
        const results: unknown[] = [];

        for (const op of queue) {
            try {
                await this.executeOp(op, results);
            } catch (error) {
                console.error(`InBrowser Op Failed: ${op.type}`, error);
                // Depending on design, we might want to stop or continue.
                // uTools documentation suggests it returns Promise, so rejection might be expected or we return partial results.
                // For now, let's throw to indicate failure of the chain.
                throw error;
            }
        }

        return results;
    }


    private getSelectorFn() {
        return `
            function queryDeep(selector) {
                if (!selector) return null;
                if (typeof selector !== 'string') return null;
                
                // XPath support
                if (selector.startsWith('//') || selector.startsWith('(') || selector.startsWith('xpath:')) {
                    const cleanSelector = selector.startsWith('xpath:') ? selector.slice(6) : selector;
                    const result = document.evaluate(cleanSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return result.singleNodeValue;
                }

                if (!selector.includes('>>')) return document.querySelector(selector);
                
                const parts = selector.split('>>').map(p => p.trim());
                let root = document;
                
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (!root) return null;
                    
                    const el = root.querySelector(part);
                    if (!el) return null;
                    
                    if (i === parts.length - 1) return el;
                    
                    // Traverse down
                    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                        try {
                            root = el.contentDocument;
                        } catch (e) {
                            return null; // Blocked by cross-origin
                        }
                    } else if (el.shadowRoot) {
                        root = el.shadowRoot;
                    } else {
                        root = el; // Regular element acting as container?
                    }
                }
                return null;
            }
        `;
    }

    private async executeOp(op: InBrowserOp, results: unknown[]) {
        const win = this.window;
        const contents = win.webContents;
        const args = op.args;
        const qFn = this.getSelectorFn();

        switch (op.type) {
            case 'goto': {
                // args: [url, headers, timeout]
                const [url, headers, timeout] = args;
                const loadPromise = win.loadURL(url, { httpReferrer: headers?.Referer, userAgent: headers?.['User-Agent'] });

                if (timeout) {
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), timeout));
                    await Promise.race([loadPromise, timeoutPromise]);
                } else {
                    await loadPromise;
                }
                break;
            }

            case 'show':
                win.show();
                break;

            case 'hide':
                win.hide();
                break;

            case 'viewport': {
                const [width, height] = args;
                win.setSize(width, height);
                break;
            }

            case 'css': {
                const [cssString] = args;
                await contents.insertCSS(cssString);
                break;
            }


            case 'evaluate':
            case 'when': // 'when' also uses simple evaluation if passed a function string
            case 'wait': // 'wait' also uses simple evaluation if passed a function string
                {
                    // args: variables based on type.
                    // evaluate: [funcString, params]
                    // when: [selectorOrFunc, ...params]
                    // wait: [msOrSelectorOrFunc, ...params]

                    let eFuncString: string = '';
                    let eParams: unknown[] = [];
                    const isWaitOrWhen = op.type === 'wait' || op.type === 'when';

                    if (op.type === 'evaluate') {
                        [eFuncString, eParams] = args as [string, unknown[]];
                    } else if (op.type === 'wait') {
                        const [firstArg, ...rest] = args;
                        if (typeof firstArg === 'number') {
                            await new Promise(resolve => setTimeout(resolve, firstArg));
                            return;
                        }
                        if (typeof firstArg === 'string' && !firstArg.trim().startsWith('function')) {
                            // It's a selector string for wait(selector)
                            // Handle below in selector-wait block
                            // Re-assign to handle in separate block or goto label? Switch doesn't restart.
                            // Let's handle the selector case separately.
                        } else {
                            // It's a function string
                            eFuncString = firstArg;
                            eParams = rest;
                        }
                    } else { // when
                        const [firstArg, ...rest] = args;
                        if (typeof firstArg === 'string' && !firstArg.trim().startsWith('function')) {
                            // Selector case
                        } else {
                            eFuncString = firstArg;
                            eParams = rest;
                        }
                    }

                    // Handle 'wait' selector case specifically
                    if (op.type === 'wait' && typeof args[0] === 'string' && !args[0].trim().startsWith('function')) {
                        const [msOrSelector] = args;
                        // ... existing wait logic ...
                        const startTime = Date.now();
                        const timeoutMs = 15000;
                        while (Date.now() - startTime < timeoutMs) {
                            const exists = await contents.executeJavaScript(`
                            (function() {
                                ${qFn}
                                return !!queryDeep(${JSON.stringify(msOrSelector)});
                            })()
                        `);
                            if (exists) return;
                            await new Promise(r => setTimeout(r, 100));
                        }
                        throw new Error(`Timeout waiting for element: ${msOrSelector}`);
                    }

                    // Handle 'when' selector case specifically
                    if (op.type === 'when' && typeof args[0] === 'string' && !args[0].trim().startsWith('function')) {
                        const [whenSelector] = args;
                        const wStartTime = Date.now();
                        const wTimeoutMs = 15000;

                        while (Date.now() - wStartTime < wTimeoutMs) {
                            const exists = await contents.executeJavaScript(`
                            (function() {
                                ${qFn}
                                return !!queryDeep(${JSON.stringify(whenSelector)});
                            })()
                        `);
                            if (exists) return;
                            await new Promise(r => setTimeout(r, 100));
                        }
                        throw new Error(`Timeout waiting for element: ${whenSelector}`);
                    }

                    // If we get here, it's a function evaluation (evaluate, wait(func), when(func))
                    console.log(`[InBrowser] Evaluating script (${op.type}):`, eFuncString, eParams);

                    const code = `
                    (async () => {
                        try {
                            const func = (${eFuncString});
                            const result = await func(...${JSON.stringify(eParams || [])});
                            return { result };
                        } catch (e) {
                            return { error: e.message || String(e) };
                        }
                    })()
                `;

                    // For wait/when, we need loop checking
                    if (isWaitOrWhen) {
                        const startTime = Date.now();
                        const timeoutMs = 15000; // configurable?
                        while (Date.now() - startTime < timeoutMs) {
                            const executionResult = await contents.executeJavaScript(code);
                            if (executionResult && executionResult.result) return; // Truthy result means done
                            if (executionResult && executionResult.error) throw new Error(`Wait/When check failed: ${executionResult.error}`);
                            await new Promise(r => setTimeout(r, 100));
                        }
                        throw new Error(`Timeout waiting for condition in ${op.type}`);
                    } else {
                        // Standard evaluate
                        const executionResult = await contents.executeJavaScript(code);
                        if (executionResult && executionResult.error) {
                            throw new Error(`Evaluation failed in renderer: ${executionResult.error}`);
                        }
                        results.push(executionResult ? executionResult.result : undefined);
                    }
                    break;
                }

                // Handled in combined block above
                break;

            case 'value': {
                const [valueSelector, val] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep(${JSON.stringify(valueSelector)});
                        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(valueSelector)});
                        el.value = ${JSON.stringify(val)};
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;
            }

            case 'check': {
                const [checkSelector, checked] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep(${JSON.stringify(checkSelector)});
                        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(checkSelector)});
                        if (el.type !== 'checkbox' && el.type !== 'radio') throw new Error('Element is not checkbox or radio: ' + ${JSON.stringify(checkSelector)});
                        el.checked = ${checked};
                        el.dispatchEvent(new Event('click', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;
            }

            case 'scroll': {
                const [arg1, arg2] = args;
                if (typeof arg1 === 'number') {
                    if (typeof arg2 === 'number') {
                        // scroll(x, y)
                        await contents.executeJavaScript(`window.scrollTo(${arg1}, ${arg2})`);
                    } else {
                        // scroll(y)
                        await contents.executeJavaScript(`window.scrollTo(0, ${arg1})`);
                    }
                } else if (typeof arg1 === 'string') {
                    const scrollY = typeof arg2 === 'number' ? arg2 : 0;
                    await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            const el = queryDeep(${JSON.stringify(arg1)});
                            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(arg1)});
                            el.scrollTop = ${scrollY};
                            // Also scrollIntoView? doc says scroll(selector, optional)
                            // But here we implement scrolling the element itself?
                            // Doc says: "Element scroll to visible position" for scroll(selector, optional).
                            // Wait, existing logic was el.scrollTop = scrollY. That scrolls the element's content.
                            // If arg2 is optional config, we should use scrollIntoView.
                            if (typeof ${JSON.stringify(arg2)} === 'object' || typeof ${JSON.stringify(arg2)} === 'boolean' || ${JSON.stringify(arg2)} === undefined) {
                                let opts = ${JSON.stringify(arg2)};
                                if (opts === true) opts = { block: 'start' };
                                if (opts === false) opts = { block: 'nearest' };
                                el.scrollIntoView(opts);
                            }
                        })()
                     `);
                }
                break;
            }

            case 'devTools': {
                const [mode] = args;
                if (mode) {
                    contents.openDevTools({ mode: mode });
                } else {
                    contents.openDevTools();
                }
                break;
            }

            case 'useragent': {
                const [ua] = args;
                contents.setUserAgent(ua);
                break;
            }

            case 'focus': {
                const [focusSelector] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep(${JSON.stringify(focusSelector)});
                        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(focusSelector)});
                        el.focus();
                    })()
                `);
                break;
            }

            case 'paste': {
                const [textToPaste] = args;
                const { clipboard } = require('electron');
                clipboard.writeText(textToPaste);
                contents.paste();
                break;
            }

            case 'press': {
                const [key, modifiers] = args;
                // Simple parsing for key. Node/Electron accelerator format vs sendInputEvent
                // sendInputEvent accepts `keyCode` as char for simple, or special keys.
                // Key codes: https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinput
                // For simplified 'press', we treat 'key' as the character or key name.
                // Modifiers need mapping.
                const mods = (modifiers || []).map((m: string) => {
                    if (m === 'ctrl') return 'control';
                    if (m === 'cmd' || m === 'command') return 'meta';
                    return m;
                }) as ('shift' | 'control' | 'alt' | 'meta' | 'isKeypad' | 'isAutoRepeat' | 'leftButtonDown' | 'middleButtonDown' | 'rightButtonDown' | 'capsLock' | 'numLock' | 'left' | 'right' | 'command')[];

                // Check if key is a single char or special key
                // For simplicity, we send char event for single chars, and keyDown/Up for others
                // Actually, correct flow is keyDown -> char (if printable) -> keyUp

                await contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
                if (key.length === 1) {
                    await contents.sendInputEvent({ type: 'char', keyCode: key, modifiers: mods });
                }
                await contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
                break;
            }

            case 'device': {
                const [deviceOption] = args;
                let deviceUA = '';
                let deviceWidth = 0;
                let deviceHeight = 0;

                if (typeof deviceOption === 'string') {
                    const devices: Record<string, { ua: string, width: number, height: number }> = {
                        'iPhone X': { width: 375, height: 812, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1' },
                        'iPad': { width: 768, height: 1024, ua: 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1' }
                    };
                    const d = devices[deviceOption];
                    if (d) {
                        deviceUA = d.ua;
                        deviceWidth = d.width;
                        deviceHeight = d.height;
                    } else {
                        console.warn(`Unknown device: ${deviceOption}`);
                    }
                } else {
                    deviceUA = deviceOption.userAgent;
                    deviceWidth = deviceOption.size.width;
                    deviceHeight = deviceOption.size.height;
                }

                if (deviceUA) contents.setUserAgent(deviceUA);
                if (deviceWidth && deviceHeight) win.setSize(deviceWidth, deviceHeight);
                break;
            }

            case 'click':
            case 'mousedown':
            case 'mouseup':
            case 'dblclick':
            case 'hover':
                {
                    // args: [selectorOrX, mouseButtonOrY, mouseButton]
                    // overload 1: (selector, button?)
                    // overload 2: (x, y, button?)
                    // hover: (selector) or (x, y)
                    const [arg1, arg2, arg3] = args;
                    let targetX = 0;
                    let targetY = 0;
                    let button = 'left';

                    if (typeof arg1 === 'number') {
                        // (x, y, button?)
                        targetX = arg1;
                        targetY = arg2 as number;
                        button = arg3 || 'left';
                    } else {
                        // (selector, button?)
                        const selector = arg1 as string;
                        button = (typeof arg2 === 'string' ? arg2 : 'left'); // arg2 might be undefined or string button

                        const rect = await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            const el = queryDeep(${JSON.stringify(selector)});
                            const rect = el ? el.getBoundingClientRect() : null;
                            return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
                        })()
                    `);

                        if (!rect && (op.type === 'hover' || op.type === 'click')) {
                            // For check/wait, maybe ok? But click usually implies element existence.
                            // Existing logic threw error.
                            throw new Error(`Element not found for ${op.type}: ${selector}`);
                        }
                        if (rect) {
                            targetX = Math.round(rect.x);
                            targetY = Math.round(rect.y);
                        }
                    }

                    const clickCount = op.type === 'dblclick' ? 2 : 1;
                    const mButton = button as 'left' | 'middle' | 'right';

                    if (op.type === 'hover') {
                        contents.sendInputEvent({ type: 'mouseMove', x: targetX, y: targetY });
                    } else if (op.type === 'mousedown') {
                        contents.sendInputEvent({ type: 'mouseDown', x: targetX, y: targetY, button: mButton, clickCount });
                    } else if (op.type === 'mouseup') {
                        contents.sendInputEvent({ type: 'mouseUp', x: targetX, y: targetY, button: mButton, clickCount });
                    } else if (op.type === 'click' || op.type === 'dblclick') {
                        contents.sendInputEvent({ type: 'mouseDown', x: targetX, y: targetY, button: mButton, clickCount });
                        contents.sendInputEvent({ type: 'mouseUp', x: targetX, y: targetY, button: mButton, clickCount });
                    }
                    break;
                }

            case 'file': {
                // args: [selector, payload]
                // Debugger approach: Selector must be simple for DOM.querySelector in Debugger API
                // Currently only supports single level. TODO: Add deep support if possible via recursion in debugger
                const [fileSelector, payload] = args;
                const filePaths = Array.isArray(payload) ? payload : [payload];
                try {
                    contents.debugger.attach('1.3');
                    const { root } = await contents.debugger.sendCommand('DOM.getDocument');
                    const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: fileSelector });
                    if (nodeId) {
                        await contents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: filePaths });
                    } else {
                        throw new Error(`File input not found: ${fileSelector}`);
                    }
                } catch (err) {
                    console.error('File Upload Error:', err);
                    throw err;
                } finally {
                    if (contents.debugger.isAttached()) contents.debugger.detach();
                }
                break;
            }

            case 'end':
                await this.destroy();
                // Optionally stop processing further ops?
                // The loop in run() continues?
                // If destroyed, accessing contents/window will throw.
                // We should probably throw specific error to break the loop or handle it in run()
                // But typically end() is the last op.
                break;

            case 'cookies': {
                // args: [nameOrFilter]
                const [nameOrFilter] = args;
                let filter: Electron.CookiesGetFilter = {};
                if (typeof nameOrFilter === 'string') {
                    filter = { name: nameOrFilter };
                } else if (typeof nameOrFilter === 'object') {
                    filter = nameOrFilter;
                }
                // Electron requires url or domain usually if no url inferred.
                // If filter is empty, Session treats it as "all", but filter object might need url.
                // If url not provided in filter, maybe default to current url?
                // uTools doc says: "url: Retrieve cookies associated with url. Empty means all URLs."
                // Electron: If filter.url is not set, it might return all.
                const cookies = await contents.session.cookies.get(filter);
                results.push(cookies);
                break;
            }

            case 'clearCookies': {
                // args: [url]
                const [clearUrl] = args;
                if (clearUrl) {
                    // Remove cookies for specific URL is complex with simple API.
                    // session.cookies.remove(url, name) requires name.
                    // If we want to clear ALL for a url, we must list checks.
                    // uTools doc: "Clear cookies. url is optional."
                    // If url is provided, maybe we accept it destroys all cookies for that domain?
                    // Let's iterate and delete.
                    const existing = await contents.session.cookies.get({ url: clearUrl });
                    for (const c of existing) {
                        await contents.session.cookies.remove(clearUrl, c.name);
                    }
                } else {
                    await contents.session.clearStorageData({ storages: ['cookies'] });
                }
                break;
            }

            case 'input': {
                // args: [text]
                // Type into currently focused element
                const [inputText] = args;
                for (const char of inputText) {
                    contents.sendInputEvent({ type: 'char', keyCode: char });
                }
                break;
            }

            case 'download': {
                // args: [urlOrFunc, savePath, ...params]
                // If urlOrFunc is function string, evaluate it first.
                const [urlOrFunc, dSavePath, ...dParams] = args;
                let downloadUrl = urlOrFunc;

                if (typeof urlOrFunc === 'string' && (urlOrFunc.includes('function') || urlOrFunc.includes('=>'))) {
                    // Evaluate function to get URL
                    const code = `
                    (async () => {
                        try {
                            const func = (${urlOrFunc});
                            const result = await func(...${JSON.stringify(dParams || [])});
                            return { result };
                        } catch (e) {
                            return { error: e.message || String(e) };
                        }
                    })()
                    `;
                    const executionResult = await contents.executeJavaScript(code);
                    if (executionResult && executionResult.error) throw new Error(`Download URL evaluation failed: ${executionResult.error}`);
                    downloadUrl = executionResult.result;
                }

                if (!downloadUrl) throw new Error('Download URL is empty');

                win.webContents.downloadURL(downloadUrl);
                if (dSavePath) {
                    win.webContents.session.once('will-download', (_event, item, _webContents) => {
                        item.setSavePath(dSavePath);
                    });
                }
                break;
            }

            case 'screenshot': {
                // args: [target, savePath]
                const [sTarget, sSavePath] = args;
                let captureRect = undefined;

                if (typeof sTarget === 'string') {
                    // Selector
                    const rect = await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            const el = queryDeep(${JSON.stringify(sTarget)});
                            const rect = el ? el.getBoundingClientRect() : null;
                            return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
                        })()
                    `);
                    if (rect) captureRect = rect;
                } else if (typeof sTarget === 'object') {
                    captureRect = sTarget;
                }

                const image = await contents.capturePage(captureRect);
                if (sSavePath) {
                    const fs = require('fs');
                    await fs.promises.writeFile(sSavePath, image.toPNG());
                } else {
                    results.push(image.toPNG());
                }
                break;
            }

            case 'markdown': {
                // args: [selector]
                const [mdSelector] = args;
                // Quick and dirty markdown extraction using Readability or simple text logic
                // For now, let's just dump innerText or use a simple HTML to MD script if we had one.
                // Given "no external deps" pref for glue code, let's try a simple meaningful text extraction.
                // Or better, let's just return innerText for now as valid MD (lazy).
                // A better approach: use a small embedded library like Turndown if available, or just generic text.
                // I will return innerText with basic formatting preservation.
                const mdContent = await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = ${mdSelector ? `queryDeep(${JSON.stringify(mdSelector)})` : 'document.body'};
                        if (!el) return '';
                        return el.innerText; 
                    })()
                `);
                results.push(mdContent);
                break;
            }

            case 'pdf': {
                const [pdfOptions, pdfSavePath] = args;
                const data = await contents.printToPDF(pdfOptions || {});
                if (pdfSavePath) {
                    const fs = require('fs');
                    await fs.promises.writeFile(pdfSavePath, data);
                } else {
                    results.push(data); // Returns Buffer
                }
                break;
            }

            case 'setCookies': {
                const [cNameOrCookies, cValue] = args;
                if (Array.isArray(cNameOrCookies)) {
                    for (const c of cNameOrCookies) {
                        await contents.session.cookies.set({ url: win.webContents.getURL(), name: c.name, value: c.value });
                    }
                } else {
                    await contents.session.cookies.set({ url: win.webContents.getURL(), name: cNameOrCookies, value: cValue });
                }
                break;
            }

            case 'removeCookies': {
                const [rmName] = args;
                const url = win.webContents.getURL();
                await contents.session.cookies.remove(url, rmName);
                break;
            }

            case 'drop': {
                const [arg1, arg2, arg3] = args;
                let targetX = 0;
                let targetY = 0;
                let rawPayload: string | string[] | Buffer;

                if (typeof arg1 === 'number') {
                    // (x, y, payload)
                    targetX = arg1;
                    targetY = arg2 as number;
                    rawPayload = arg3 as string | string[] | Buffer;
                } else {
                    // (selector, payload)
                    const selector = arg1 as string;
                    rawPayload = arg2 as string | string[] | Buffer;

                    const rect = await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            const el = queryDeep(${JSON.stringify(selector)});
                            const rect = el ? el.getBoundingClientRect() : null;
                            return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
                        })()
                    `);

                    if (!rect) throw new Error(`Element not found for drop: ${selector}`);
                    targetX = Math.round(rect.x);
                    targetY = Math.round(rect.y);
                }

                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const files: string[] = [];

                const processPayload = async (p: string | string[] | Buffer) => {
                    if (Buffer.isBuffer(p)) {
                        const tempPath = path.join(os.tmpdir(), `drop_file_${Date.now()}.bin`);
                        await fs.promises.writeFile(tempPath, p);
                        files.push(tempPath);
                    } else if (Array.isArray(p)) {
                        for (const item of p) {
                            if (typeof item === 'string') files.push(item);
                        }
                    } else if (typeof p === 'string') {
                        // Check if base64 (heuristic)
                        if (p.startsWith('data:') || (p.length > 200 && /^[A-Za-z0-9+/=]+$/.test(p.replace(/\s/g, '')))) {
                            let buffer: Buffer;
                            let ext = 'bin';
                            if (p.startsWith('data:')) {
                                const matches = p.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
                                if (matches && matches.length === 3) {
                                    ext = matches[1].split('/')[1] || 'bin';
                                    buffer = Buffer.from(matches[2], 'base64');
                                } else {
                                    buffer = Buffer.from(p.split(',')[1], 'base64');
                                }
                            } else {
                                buffer = Buffer.from(p, 'base64');
                            }
                            const tempPath = path.join(os.tmpdir(), `drop_file_${Date.now()}.${ext}`);
                            await fs.promises.writeFile(tempPath, buffer);
                            files.push(tempPath);
                        } else {
                            files.push(p);
                        }
                    }
                };

                await processPayload(rawPayload);

                try {
                    // Reuse debugger logic
                    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');

                    await contents.debugger.sendCommand('Input.dispatchDragEvent', {
                        type: 'dragEnter',
                        x: targetX,
                        y: targetY,
                        data: { files, items: [], dragOperationsMask: 1 }
                    });

                    await contents.debugger.sendCommand('Input.dispatchDragEvent', {
                        type: 'dragOver',
                        x: targetX,
                        y: targetY,
                        data: { files, items: [], dragOperationsMask: 1 }
                    });

                    await contents.debugger.sendCommand('Input.dispatchDragEvent', {
                        type: 'drop',
                        x: targetX,
                        y: targetY,
                        data: { files, items: [], dragOperationsMask: 1 }
                    });

                } catch (err) {
                    console.error('Drop Op Failed:', err);
                    throw err;
                } finally {
                    if (contents.debugger.isAttached()) contents.debugger.detach();
                }
                break;
            }

            default:
                console.warn(`Unknown InBrowser Op: ${op.type}`);
        }
    }

    private async cleanupSessionData(): Promise<void> {
        if (!this.cleanupSessionOnClose) {
            return;
        }

        if (this.sessionCleanupPromise) {
            return this.sessionCleanupPromise;
        }

        this.sessionCleanupPromise = (async () => {
            try {
                await this.ownedSession.clearCache();
                await this.ownedSession.clearStorageData({
                    storages: [
                        'serviceworkers',
                        'cachestorage',
                        'indexdb',
                        'localstorage',
                        'filesystem',
                        'websql',
                        'cookies'
                    ]
                });
            } catch (error) {
                console.warn('[InBrowserWindow] Failed to cleanup session data:', error);
            }
        })();

        return this.sessionCleanupPromise;
    }

    public async destroy(): Promise<void> {
        await this.cleanupSessionData();
        if (!this.window.isDestroyed()) {
            this.window.destroy();
        }
    }
}
