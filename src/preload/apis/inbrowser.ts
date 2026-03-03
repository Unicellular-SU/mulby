import { ipcRenderer } from 'electron';
import { InBrowserOp, InBrowserOptions, InBrowserRunPayload } from '../../shared/types/inbrowser';

type SerializableFn = (...args: unknown[]) => unknown;
type MouseButton = 'left' | 'middle' | 'right';
type ScreenshotTarget = string | { x: number; y: number; width: number; height: number };

export class InBrowserBuilder {
    private queue: InBrowserOp[] = [];

    constructor() { }

    public goto = (url: string, headers?: Record<string, string>, timeout?: number): this => {
        this.queue.push({
            type: 'goto',
            args: [url, headers, timeout],
        });
        return this;
    }

    public useragent = (ua: string): this => {
        this.queue.push({ type: 'useragent', args: [ua] });
        return this;
    }

    public device = (options: { userAgent: string; size: { width: number; height: number } } | string): this => {
        // Support legacy string or new object
        this.queue.push({ type: 'device', args: [options] });
        return this;
    }

    public click = (selectorOrX: string | number, mouseButtonOrY?: 'left' | 'middle' | 'right' | number, mouseButton?: 'left' | 'middle' | 'right'): this => {
        this.queue.push({ type: 'click', args: [selectorOrX, mouseButtonOrY, mouseButton] });
        return this;
    }

    public mousedown = (selectorOrX: string | number, mouseButtonOrY?: 'left' | 'middle' | 'right' | number, mouseButton?: 'left' | 'middle' | 'right'): this => {
        this.queue.push({ type: 'mousedown', args: [selectorOrX, mouseButtonOrY, mouseButton] });
        return this;
    }

    public mouseup = (selectorOrX: string | number, mouseButtonOrY?: 'left' | 'middle' | 'right' | number, mouseButton?: 'left' | 'middle' | 'right'): this => {
        this.queue.push({ type: 'mouseup', args: [selectorOrX, mouseButtonOrY, mouseButton] });
        return this;
    }

    public dblclick = (selectorOrX: string | number, mouseButtonOrY?: 'left' | 'middle' | 'right' | number, mouseButton?: 'left' | 'middle' | 'right'): this => {
        this.queue.push({ type: 'dblclick', args: [selectorOrX, mouseButtonOrY, mouseButton] });
        return this;
    }

    public hover = (selectorOrX: string | number, y?: number): this => {
        this.queue.push({ type: 'hover', args: [selectorOrX, y] });
        return this;
    }

    // Legacy support: type(selector, text) -> now via input(selector, text) or just keep as alias
    public type = (selector: string, text: string): this => {
        this.queue.push({ type: 'type', args: [selector, text] });
        return this;
    }

    public input = (selectorOrText: string, text?: string): this => {
        if (text === undefined) {
            // input(text) - types into focused
            this.queue.push({ type: 'input', args: [selectorOrText] });
        } else {
            // input(selector, text) - types into selector
            this.queue.push({ type: 'type', args: [selectorOrText, text] });
        }
        return this;
    }

    public press = (key: string, modifiers?: string[]): this => {
        this.queue.push({ type: 'press', args: [key, modifiers] });
        return this;
    }

    public show = (): this => {
        this.queue.push({ type: 'show', args: [] });
        return this;
    }

    public hide = (): this => {
        this.queue.push({ type: 'hide', args: [] });
        return this;
    }

    public viewport = (width: number, height: number): this => {
        this.queue.push({ type: 'viewport', args: [width, height] });
        return this;
    }

    public css = (css: string): this => {
        this.queue.push({ type: 'css', args: [css] });
        return this;
    }

    public when = (selectorOrFunc: string | SerializableFn, ...params: unknown[]): this => {
        let funcString: string | undefined;
        if (typeof selectorOrFunc === 'function') {
            funcString = selectorOrFunc.toString();
            // Simple native code check
            if (funcString.includes('[native code]')) throw new Error('Cannot serialize native function');
            this.queue.push({ type: 'when', args: [funcString, ...params] });
        } else {
            this.queue.push({ type: 'when', args: [selectorOrFunc, ...params] });
        }
        return this;
    }

    public cookies = (nameOrFilter?: unknown): this => {
        this.queue.push({ type: 'cookies', args: [nameOrFilter] });
        return this;
    }

    public setCookies = (nameOrCookies: string | { name: string; value: string }[], value?: string): this => {
        this.queue.push({ type: 'setCookies', args: [nameOrCookies, value] });
        return this;
    }

    public removeCookies = (name: string): this => {
        this.queue.push({ type: 'removeCookies', args: [name] });
        return this;
    }

    public clearCookies = (url?: string): this => {
        this.queue.push({ type: 'clearCookies', args: [url] });
        return this;
    }

    public value = (selector: string, val: string): this => {
        this.queue.push({ type: 'value', args: [selector, val] });
        return this;
    }

    public check = (selector: string, checked: boolean): this => {
        this.queue.push({ type: 'check', args: [selector, checked] });
        return this;
    }

    public scroll = (selectorOrYOrX: string | number, optionalOrY?: unknown): this => {
        // This is complex because of overloaded signatures.
        // scroll(selector, optional)
        // scroll(y)
        // scroll(x, y)
        this.queue.push({ type: 'scroll', args: [selectorOrYOrX, optionalOrY] });
        return this;
    }

    public devTools = (mode?: 'right' | 'bottom' | 'undocked' | 'detach'): this => {
        this.queue.push({ type: 'devTools', args: [mode] });
        return this;
    }

    public focus = (selector: string): this => {
        this.queue.push({ type: 'focus', args: [selector] });
        return this;
    }

    public paste = (text: string): this => {
        this.queue.push({ type: 'paste', args: [text] });
        return this;
    }

    public end = (): this => {
        this.queue.push({ type: 'end', args: [] });
        return this;
    }

    public pdf = (options?: Electron.PrintToPDFOptions, savePath?: string): this => {
        this.queue.push({ type: 'pdf', args: [options, savePath] });
        return this;
    }

    public screenshot = (target?: string | { x: number; y: number; width: number; height: number }, savePath?: string): this => {
        this.queue.push({ type: 'screenshot', args: [target, savePath] });
        return this;
    }

    public markdown = (selector?: string): this => {
        this.queue.push({ type: 'markdown', args: [selector] });
        return this;
    }

    public download = (urlOrFunc: string | SerializableFn, savePath?: string | null, ...params: unknown[]): this => {
        let funcString: string | undefined;
        if (typeof urlOrFunc === 'function') {
            funcString = urlOrFunc.toString();
            this.queue.push({ type: 'download', args: [funcString, savePath, ...params] });
        } else {
            this.queue.push({ type: 'download', args: [urlOrFunc, savePath] });
        }
        return this;
    }

    public evaluate = (func: string | SerializableFn, ...params: unknown[]): this => {
        let funcString: string;
        if (typeof func === 'function') {
            funcString = func.toString();
            if (funcString.includes('[native code]')) {
                throw new Error('Cannot serialize function passed across ContextBridge. Please pass the function as a string or use .toString().');
            }
        } else {
            funcString = func;
        }

        this.queue.push({
            type: 'evaluate',
            args: [funcString, params],
        });
        return this;
    }

    public wait = (msOrSelectorOrFunc: number | string | SerializableFn, ...args: unknown[]): this => {
        if (typeof msOrSelectorOrFunc === 'function') {
            const funcString = msOrSelectorOrFunc.toString();
            this.queue.push({ type: 'wait', args: [funcString, ...args] });
        } else {
            this.queue.push({ type: 'wait', args: [msOrSelectorOrFunc, ...args] });
        }
        return this;
    }

    public file = (selector: string, payload: string | string[] | Buffer): this => {
        this.queue.push({ type: 'file', args: [selector, payload] });
        return this;
    }

    public drop = (selectorOrX: string | number, optionalYOrPayload: number | string | string[] | Buffer, payload?: string | string[] | Buffer): this => {
        this.queue.push({ type: 'drop', args: [selectorOrX, optionalYOrPayload, payload] });
        return this;
    }

    public run = async (idOrOptions?: number | InBrowserOptions, options?: InBrowserOptions): Promise<unknown[]> => {
        const payload: InBrowserRunPayload = { queue: this.queue };

        if (typeof idOrOptions === 'number') {
            payload.id = idOrOptions;
            if (options) payload.options = options;
        } else if (idOrOptions) {
            payload.options = idOrOptions;
        }

        return ipcRenderer.invoke('inbrowser:run', payload);
    }
}

// Expose all methods that can start a chain
export const inbrowser = {
    // Navigation
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => new InBrowserBuilder().goto(url, headers, timeout),

    // Configuration / Setup
    useragent: (ua: string) => new InBrowserBuilder().useragent(ua),
    device: (options: { userAgent: string; size: { width: number; height: number } } | string) => new InBrowserBuilder().device(options),
    viewport: (width: number, height: number) => new InBrowserBuilder().viewport(width, height),
    show: () => new InBrowserBuilder().show(),
    hide: () => new InBrowserBuilder().hide(),
    devTools: (mode?: 'right' | 'bottom' | 'undocked' | 'detach') => new InBrowserBuilder().devTools(mode),

    // Direct Actions
    click: (selectorOrX: string | number, mouseButtonOrY?: MouseButton | number, mouseButton?: MouseButton) =>
      new InBrowserBuilder().click(selectorOrX, mouseButtonOrY, mouseButton),
    mousedown: (selectorOrX: string | number, mouseButtonOrY?: MouseButton | number, mouseButton?: MouseButton) =>
      new InBrowserBuilder().mousedown(selectorOrX, mouseButtonOrY, mouseButton),
    mouseup: (selectorOrX: string | number, mouseButtonOrY?: MouseButton | number, mouseButton?: MouseButton) =>
      new InBrowserBuilder().mouseup(selectorOrX, mouseButtonOrY, mouseButton),
    dblclick: (selectorOrX: string | number, mouseButtonOrY?: MouseButton | number, mouseButton?: MouseButton) =>
      new InBrowserBuilder().dblclick(selectorOrX, mouseButtonOrY, mouseButton),
    hover: (selectorOrX: string | number, y?: number) => new InBrowserBuilder().hover(selectorOrX, y),
    type: (selector: string, text: string) => new InBrowserBuilder().type(selector, text),
    input: (selectorOrText: string, text?: string) => new InBrowserBuilder().input(selectorOrText, text),
    value: (selector: string, val: string) => new InBrowserBuilder().value(selector, val),
    check: (selector: string, checked: boolean) => new InBrowserBuilder().check(selector, checked),
    focus: (selector: string) => new InBrowserBuilder().focus(selector),
    paste: (text: string) => new InBrowserBuilder().paste(text),
    press: (key: string, modifiers?: string[]) => new InBrowserBuilder().press(key, modifiers),
    scroll: (arg1: string | number, arg2?: unknown) => new InBrowserBuilder().scroll(arg1, arg2),
    file: (selector: string, payload: string | string[]) => new InBrowserBuilder().file(selector, payload),
    drop: (selectorOrX: string | number, optionalYOrPayload: number | string | string[] | Buffer, payload?: string | string[] | Buffer) =>
      new InBrowserBuilder().drop(selectorOrX, optionalYOrPayload, payload),
    download: (urlOrFunc: string | SerializableFn, savePath?: string | null, ...params: unknown[]) =>
      new InBrowserBuilder().download(urlOrFunc, savePath, ...params),
    screenshot: (target?: ScreenshotTarget, savePath?: string) => new InBrowserBuilder().screenshot(target, savePath),
    markdown: (selector?: string) => new InBrowserBuilder().markdown(selector),

    // Data / Execution
    evaluate: (func: string | SerializableFn, ...params: unknown[]) => new InBrowserBuilder().evaluate(func, ...params),
    cookies: (nameOrFilter?: unknown) => new InBrowserBuilder().cookies(nameOrFilter),
    setCookies: (nameOrCookies: string | { name: string; value: string }[], value?: string) => new InBrowserBuilder().setCookies(nameOrCookies, value),
    removeCookies: (name: string) => new InBrowserBuilder().removeCookies(name),
    clearCookies: (url?: string) => new InBrowserBuilder().clearCookies(url),
    pdf: (options?: Electron.PrintToPDFOptions, savePath?: string) => new InBrowserBuilder().pdf(options, savePath),
    wait: (msOrSelectorOrFunc: number | string | SerializableFn, ...args: unknown[]): InBrowserBuilder => new InBrowserBuilder().wait(msOrSelectorOrFunc, ...args),
    when: (selectorOrFunc: string | SerializableFn, ...params: unknown[]) => new InBrowserBuilder().when(selectorOrFunc, ...params),

    // Ending
    end: () => new InBrowserBuilder().end(),

    // Manager Methods
    getIdleInBrowsers: () => ipcRenderer.invoke('inbrowser:getIdleInBrowsers'),
    setInBrowserProxy: (config: Electron.Config) => ipcRenderer.invoke('inbrowser:setInBrowserProxy', config),
    clearInBrowserCache: () => ipcRenderer.invoke('inbrowser:clearInBrowserCache'),
};
