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

    private async executeOp(op: InBrowserOp, results: any[]) {
        const win = this.window;
        const contents = win.webContents;
        const args = op.args;

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

                // Wrap in try-catch to return error object if script fails
                // We use an IIFE that returns a Promise resolving to { result, error }
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
                const [ms] = args;
                await new Promise(resolve => setTimeout(resolve, ms));
                break;

            case 'click':
                // args: [selector]
                const [selector] = args;
                const rect = await contents.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            if (!el) throw new Error('Element not found: ${selector}');
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          })()
        `);
                // We need integers for input events
                const x = Math.round(rect.x);
                const y = Math.round(rect.y);

                contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
                contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
                break;

            case 'type':
                // args: [selector, text]
                const [typeSelector, text] = args;
                // First click to focus
                await this.executeOp({ type: 'click', args: [typeSelector] }, results);

                // Then type each character
                for (const char of text) {
                    contents.sendInputEvent({ type: 'char', keyCode: char });
                }
                break;

            case 'press':
                // args: [key, modifiers]
                const [key, modifiers] = args;
                // Electron accelerator format or simple char? uTools says 'key'
                // For sendInputEvent, we need keyCode.
                // This is complex because mapping 'Enter' to '\r' etc might be needed.
                // For Phase 1, basic char press:

                const lowerKey = key.toLowerCase();
                let keyCode = key;

                // Simple mapping for common keys
                if (lowerKey === 'enter') keyCode = '\r';
                if (lowerKey === 'tab') keyCode = '\t';

                contents.sendInputEvent({ type: 'keyDown', keyCode: keyCode, modifiers: modifiers as any });
                contents.sendInputEvent({ type: 'char', keyCode: keyCode, modifiers: modifiers as any });
                contents.sendInputEvent({ type: 'keyUp', keyCode: keyCode, modifiers: modifiers as any });
                break;


            // TODO: Implement other ops: click, press, type, value, checkbox, etc.

            case 'css':
                // args: [css]
                const [css] = args;
                await contents.insertCSS(css);
                break;

            case 'when':
                // args: [selector]
                const [whenSelector] = args;
                const startTime = Date.now();
                const timeoutMs = 15000; // Default 15s timeout

                while (Date.now() - startTime < timeoutMs) {
                    const exists = await contents.executeJavaScript(`!!document.querySelector('${whenSelector}')`);
                    if (exists) return;
                    await new Promise(r => setTimeout(r, 100)); // poll every 100ms
                }
                // If timeout, should we throw? uTools doc says "Returns void. Wait for element to exist"
                // Let's throw for now to stop chain execution
                throw new Error(`Timeout waiting for element: ${whenSelector}`);
                break;

            case 'value':
                // args: [selector, val]
                const [valueSelector, val] = args;
                await contents.executeJavaScript(`
                    (function() {
                        const el = document.querySelector('${valueSelector}');
                        if (!el) throw new Error('Element not found: ${valueSelector}');
                        el.value = '${val}';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;

            case 'check':
                // args: [selector, checked]
                const [checkSelector, checked] = args;
                await contents.executeJavaScript(`
                    (function() {
                        const el = document.querySelector('${checkSelector}');
                        if (!el) throw new Error('Element not found: ${checkSelector}');
                        if (el.type !== 'checkbox' && el.type !== 'radio') throw new Error('Element is not checkbox or radio: ${checkSelector}');
                        el.checked = ${checked};
                        el.dispatchEvent(new Event('click', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    })()
                `);
                break;

            case 'scroll':
                // args: [selector | y, y]
                const [arg1, arg2] = args;
                if (typeof arg1 === 'number') {
                    // Global scroll: scroll(y)
                    await contents.executeJavaScript(`window.scrollTo(0, ${arg1})`);
                } else if (typeof arg1 === 'string') {
                    // Element scroll: scroll(selector, y)
                    const scrollY = typeof arg2 === 'number' ? arg2 : 0;
                    await contents.executeJavaScript(`
                        (function() {
                            const el = document.querySelector('${arg1}');
                            if (!el) throw new Error('Element not found: ${arg1}');
                            el.scrollTop = ${scrollY};
                        })()
                     `);
                }
                break;

            case 'devTools':
                // args: [mode]
                const [mode] = args;
                if (mode) {
                    contents.openDevTools({ mode: mode });
                } else {
                    contents.openDevTools();
                }
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
