import { ipcRenderer } from 'electron';
import { InBrowserOp, InBrowserOptions, InBrowserRunPayload } from '../shared/types/inbrowser';

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

    public device = (name: string): this => {
        this.queue.push({ type: 'device', args: [name] });
        return this;
    }

    public click = (selector: string): this => {
        this.queue.push({ type: 'click', args: [selector] });
        return this;
    }

    public mousedown = (selector: string): this => {
        this.queue.push({ type: 'mousedown', args: [selector] });
        return this;
    }

    public mouseup = (selector: string): this => {
        this.queue.push({ type: 'mouseup', args: [selector] });
        return this;
    }

    public type = (selector: string, text: string): this => {
        this.queue.push({ type: 'type', args: [selector, text] });
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

    public when = (selector: string): this => {
        this.queue.push({ type: 'when', args: [selector] });
        return this;
    }

    public cookies = (name?: string): this => {
        this.queue.push({ type: 'cookies', args: [name] });
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

    public scroll = (selector: string | number, y?: number): this => {
        // If first arg is number, it's global scroll y, second arg ignored
        // If first arg is string, it's selector, second arg is y
        this.queue.push({ type: 'scroll', args: [selector, y] });
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

    public evaluate = (func: string | Function, ...params: any[]): this => {
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

    public wait = (ms: number): this => {
        this.queue.push({ type: 'wait', args: [ms] });
        return this;
    }

    public file = (selector: string, payload: string | string[]): this => {
        this.queue.push({ type: 'file', args: [selector, payload] });
        return this;
    }

    public run = async (options?: InBrowserOptions): Promise<any[]> => {
        const payload: InBrowserRunPayload = {
            queue: this.queue,
            options: options || {},
        };
        return ipcRenderer.invoke('inbrowser:run', payload);
    }
}

// Expose all methods that can start a chain
export const inbrowser = {
    // Navigation
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => new InBrowserBuilder().goto(url, headers, timeout),

    // Configuration / Setup
    useragent: (ua: string) => new InBrowserBuilder().useragent(ua),
    device: (name: string) => new InBrowserBuilder().device(name),
    viewport: (width: number, height: number) => new InBrowserBuilder().viewport(width, height),
    show: () => new InBrowserBuilder().show(),
    hide: () => new InBrowserBuilder().hide(),
    devTools: (mode?: 'right' | 'bottom' | 'undocked' | 'detach') => new InBrowserBuilder().devTools(mode),

    // Direct Actions (less common to start with, but supported)
    click: (selector: string) => new InBrowserBuilder().click(selector),
    mousedown: (selector: string) => new InBrowserBuilder().mousedown(selector),
    mouseup: (selector: string) => new InBrowserBuilder().mouseup(selector),
    type: (selector: string, text: string) => new InBrowserBuilder().type(selector, text),
    value: (selector: string, val: string) => new InBrowserBuilder().value(selector, val),
    check: (selector: string, checked: boolean) => new InBrowserBuilder().check(selector, checked),
    focus: (selector: string) => new InBrowserBuilder().focus(selector),
    paste: (text: string) => new InBrowserBuilder().paste(text),
    press: (key: string, modifiers?: string[]) => new InBrowserBuilder().press(key, modifiers),
    scroll: (selector: string | number, y?: number) => new InBrowserBuilder().scroll(selector, y),
    file: (selector: string, payload: string | string[]) => new InBrowserBuilder().file(selector, payload),

    // Data / Execution
    evaluate: (func: string | Function, ...params: any[]) => new InBrowserBuilder().evaluate(func, ...params),
    cookies: (name?: string) => new InBrowserBuilder().cookies(name),
    pdf: (options?: Electron.PrintToPDFOptions, savePath?: string) => new InBrowserBuilder().pdf(options, savePath),
    wait: (ms: number) => new InBrowserBuilder().wait(ms),
    when: (selector: string) => new InBrowserBuilder().when(selector),

    // Ending (makes no sense to start with end, but for completeness)
    end: () => new InBrowserBuilder().end(),
};
