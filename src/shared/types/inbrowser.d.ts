export interface InBrowserOptions {
    show?: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    center?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizable?: boolean;
    movable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    alwaysOnTop?: boolean;
    fullscreen?: boolean;
    fullscreenable?: boolean;
    enableLargerThanScreen?: boolean;
    opacity?: number;
    frame?: boolean;
    closable?: boolean;
    focusable?: boolean;
    skipTaskbar?: boolean;
    backgroundColor?: string;
    hasShadow?: boolean;
    transparent?: boolean;
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
    thickFrame?: boolean;
    webPreferences?: Electron.WebPreferences;
}

export interface InBrowserOp {
    type: 'goto' | 'show' | 'hide' | 'viewport' | 'click' | 'type' | 'press' | 'evaluate' | 'wait' | 'css' | 'when' | 'cookies' | 'pdf' | 'value' | 'check' | 'scroll' | 'devTools' | 'useragent' | 'focus' | 'end' | 'paste' | 'file' | 'device' | 'mousedown' | 'mouseup' | 'input' | 'clearCookies';
    args: any[];
}

export interface InBrowserRunPayload {
    id?: number;
    options?: InBrowserOptions;
    queue: InBrowserOp[];
}

export interface InBrowserResult {
    id: number;
    result: any[];
}

export interface InBrowser {
    goto(url: string, headers?: Record<string, string>, timeout?: number): InBrowser;
    show(): InBrowser;
    hide(): InBrowser;
    viewport(width: number, height: number): InBrowser;
    evaluate(func: string | Function, ...params: any[]): InBrowser;
    wait(msOrSelector: number | string): InBrowser;
    click(selector: string): InBrowser;
    type(selector: string, text: string): InBrowser;
    input(selectorOrText: string, text?: string): InBrowser; // Alias for type/value, but uTools `input(text)` implies typing into FOCUSED element? OR `input(selector, text)`?
    // User request: `.input(matchs[2])` AFTER `.focus(...)`. So `input(text)` where text is typed into currently focused element.
    // uTools docs say: `.input(text)` inputs text. 
    // And `.type(selector, text)` types into selector.
    // So `input` here is likely "type into focused".
    press(key: string, modifiers?: string[]): InBrowser;

    // Advanced features
    css(css: string): InBrowser;
    when(selector: string): InBrowser;
    cookies(name?: string): InBrowser;
    clearCookies(url?: string): InBrowser;
    pdf(options?: Electron.PrintToPDFOptions, savePath?: string): InBrowser;

    run(options?: InBrowserOptions): Promise<any[]>;
}
