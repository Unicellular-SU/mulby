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

    public click = (selector: string): this => {
        this.queue.push({ type: 'click', args: [selector] });
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

    public run = async (options?: InBrowserOptions): Promise<any[]> => {
        const payload: InBrowserRunPayload = {
            queue: this.queue,
            options: options || {},
        };
        return ipcRenderer.invoke('inbrowser:run', payload);
    }
}

export const inbrowser = {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => {
        return new InBrowserBuilder().goto(url, headers, timeout);
    },
};
