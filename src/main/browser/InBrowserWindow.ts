import { BrowserWindow } from 'electron';
import { InBrowserOp, InBrowserOptions } from '../../shared/types/inbrowser';

export class InBrowserWindow {
    public window: BrowserWindow;
    public id: number;

    constructor(options: InBrowserOptions) {
        this.window = new BrowserWindow({
            ...options,
            show: options.show || false, // Default to hidden
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                ...options.webPreferences,
            },
        });
        this.id = this.window.id;
    }

    public async run(queue: InBrowserOp[]): Promise<any[]> {
        const results: any[] = [];

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

    private async executeOp(op: InBrowserOp, results: any[]) {
        const win = this.window;
        const contents = win.webContents;
        const args = op.args;
        const qFn = this.getSelectorFn();

        switch (op.type) {
            case 'goto':
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

            case 'show':
                win.show();
                break;

            case 'hide':
                win.hide();
                break;

            case 'viewport':
                const [width, height] = args;
                win.setSize(width, height);
                break;

            case 'evaluate':
                // args: [funcString, params]
                const [funcString, params] = args;
                console.log(`[InBrowser] Evaluating script:`, funcString, params);

                const code = `
                    (async () => {
                        try {
                            const func = (${funcString});
                            const result = await func(...${JSON.stringify(params || [])});
                            return { result };
                        } catch (e) {
                            return { error: e.message || String(e) };
                        }
                    })()
                `;

                const executionResult = await contents.executeJavaScript(code);

                if (executionResult && executionResult.error) {
                    throw new Error(`Evaluation failed in renderer: ${executionResult.error}`);
                }

                results.push(executionResult ? executionResult.result : undefined);
                break;

            case 'wait':
                const [msOrSelector] = args;
                if (typeof msOrSelector === 'number') {
                    await new Promise(resolve => setTimeout(resolve, msOrSelector));
                } else if (typeof msOrSelector === 'string') {
                    // wait(selector) alias style
                    // Actually wait args is [ms] in type definition, but InBrowserBuilder allows 'wait' to take ms.
                    // 'when' handles selector waiting. 
                    // EXCEPT... User request: .wait("iframe#outer >> ..."). 
                    // So we must handle string selector in 'wait' too if the API allows it (overloading).
                    // In types.d.ts `wait(ms: number)` is defined. 
                    // But uTools `wait` is polymorphic. Let's support it if passed.
                    // We need to check if args[0] is string.
                    const startTime = Date.now();
                    const timeoutMs = 15000;
                    while (Date.now() - startTime < timeoutMs) {
                        const exists = await contents.executeJavaScript(`
                            (function() {
                                ${qFn}
                                return !!queryDeep('${msOrSelector}');
                            })()
                        `);
                        if (exists) return;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    throw new Error(`Timeout waiting for element: ${msOrSelector}`);
                }
                break;

            case 'click':
                // args: [selector]
                const [selector] = args;
                const rect = await contents.executeJavaScript(`
                  (function() {
                    ${qFn}
                    const el = queryDeep('${selector}');
                    if (!el) throw new Error('Element not found: ${selector}');
                    const rect = el.getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                  })()
                `);
                const x = Math.round(rect.x);
                const y = Math.round(rect.y);

                contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
                contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
                break;

            case 'type':
                // args: [selector, text]
                const [typeSelector, text] = args;
                await this.executeOp({ type: 'click', args: [typeSelector] }, results);
                for (const char of text) {
                    contents.sendInputEvent({ type: 'char', keyCode: char });
                }
                break;

            case 'press':
                // args: [key, modifiers]
                const [key, modifiers] = args;
                const lowerKey = key.toLowerCase();
                let keyCode = key;
                if (lowerKey === 'enter') keyCode = '\r';
                if (lowerKey === 'tab') keyCode = '\t';

                contents.sendInputEvent({ type: 'keyDown', keyCode: keyCode, modifiers: modifiers as any });
                contents.sendInputEvent({ type: 'char', keyCode: keyCode, modifiers: modifiers as any });
                contents.sendInputEvent({ type: 'keyUp', keyCode: keyCode, modifiers: modifiers as any });
                break;

            case 'css':
                const [css] = args;
                await contents.insertCSS(css);
                break;

            case 'when':
                const [whenSelector] = args;
                const wStartTime = Date.now();
                const wTimeoutMs = 15000;

                while (Date.now() - wStartTime < wTimeoutMs) {
                    const exists = await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            return !!queryDeep('${whenSelector}');
                        })()
                    `);
                    if (exists) return;
                    await new Promise(r => setTimeout(r, 100));
                }
                throw new Error(`Timeout waiting for element: ${whenSelector}`);
                break;

            case 'value':
                const [valueSelector, val] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep('${valueSelector}');
                        if (!el) throw new Error('Element not found: ${valueSelector}');
                        el.value = '${val}';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;

            case 'check':
                const [checkSelector, checked] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep('${checkSelector}');
                        if (!el) throw new Error('Element not found: ${checkSelector}');
                        if (el.type !== 'checkbox' && el.type !== 'radio') throw new Error('Element is not checkbox or radio: ${checkSelector}');
                        el.checked = ${checked};
                        el.dispatchEvent(new Event('click', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;

            case 'scroll':
                const [arg1, arg2] = args;
                if (typeof arg1 === 'number') {
                    await contents.executeJavaScript(`window.scrollTo(0, ${arg1})`);
                } else if (typeof arg1 === 'string') {
                    const scrollY = typeof arg2 === 'number' ? arg2 : 0;
                    await contents.executeJavaScript(`
                        (function() {
                            ${qFn}
                            const el = queryDeep('${arg1}');
                            if (!el) throw new Error('Element not found: ${arg1}');
                            el.scrollTop = ${scrollY};
                        })()
                     `);
                }
                break;

            case 'devTools':
                const [mode] = args;
                if (mode) {
                    contents.openDevTools({ mode: mode });
                } else {
                    contents.openDevTools();
                }
                break;

            case 'useragent':
                const [ua] = args;
                contents.setUserAgent(ua);
                break;

            case 'focus':
                const [focusSelector] = args;
                await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep('${focusSelector}');
                        if (!el) throw new Error('Element not found: ${focusSelector}');
                        el.focus();
                    })()
                `);
                break;

            case 'paste':
                const [textToPaste] = args;
                const { clipboard } = require('electron');
                clipboard.writeText(textToPaste);
                contents.paste();
                break;

            case 'device':
                const [deviceName] = args;
                const devices: Record<string, { ua: string, width: number, height: number }> = {
                    'iPhone X': { width: 375, height: 812, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1' },
                    'iPad': { width: 768, height: 1024, ua: 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1' }
                };
                const device = devices[deviceName];
                if (device) {
                    contents.setUserAgent(device.ua);
                    win.setSize(device.width, device.height);
                } else {
                    console.warn(`Unknown device: ${deviceName}`);
                }
                break;

            case 'mousedown':
            case 'mouseup':
                const [mouseSelector] = args;
                const mouseRect = await contents.executeJavaScript(`
                    (function() {
                        ${qFn}
                        const el = queryDeep('${mouseSelector}');
                        if (!el) throw new Error('Element not found: ${mouseSelector}');
                        const rect = el.getBoundingClientRect();
                        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                    })()
                `);
                const mouseX = Math.round(mouseRect.x);
                const mouseY = Math.round(mouseRect.y);
                const mouseType = op.type === 'mousedown' ? 'mouseDown' : 'mouseUp';
                contents.sendInputEvent({ type: mouseType, x: mouseX, y: mouseY, button: 'left', clickCount: 1 });
                break;

            case 'file':
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

            case 'end':
                this.destroy();
                // Optionally stop processing further ops?
                // The loop in run() continues?
                // If destroyed, accessing contents/window will throw.
                // We should probably throw specific error to break the loop or handle it in run()
                // But typically end() is the last op.
                break;

            case 'cookies':
                // args: [name]
                const [cookieName] = args;
                const cookies = await contents.session.cookies.get(cookieName ? { name: cookieName } : {});
                results.push(cookies);
                break;

            case 'pdf':
                // args: [options, savePath]
                const [pdfOptions, savePath] = args;
                const data = await contents.printToPDF(pdfOptions || {});
                if (savePath) {
                    const fs = require('fs');
                    // TODO: Ensure directory exists?
                    // Using clean require for now inside method to avoid top-level issues if any
                    await fs.promises.writeFile(savePath, data);
                } else {
                    results.push(data); // Return Buffer if no path
                }
                break;

            default:
                console.warn(`Unknown InBrowser Op: ${op.type}`);
        }
    }

    public destroy() {
        if (!this.window.isDestroyed()) {
            this.window.destroy();
        }
    }
}
