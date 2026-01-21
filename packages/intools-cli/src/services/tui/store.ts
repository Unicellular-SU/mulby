import { EventEmitter } from 'events';

class TerminalStore extends EventEmitter {
    public logs: string[] = [];
    public isPrompting: boolean = false;
    public statusMessage: string = '';
    public isSelecting: boolean = false;
    public selectItems: Array<{ label: string; value: string }> = [];
    private selectResolver: ((value: string) => void) | null = null;
    private inputResolver: ((value: string) => void) | null = null;

    addLog(msg: string) {
        this.logs.push(msg);
        this.emit('change');
    }

    setStatus(msg: string) {
        this.statusMessage = msg;
        this.emit('change');
    }

    startPrompt(): Promise<string> {
        return new Promise((resolve) => {
            if (this.isSelecting) {
                // Should ideally cancel selection or queue, but for now override
                this.isSelecting = false;
            }
            this.isPrompting = true;
            this.inputResolver = resolve;
            this.emit('change');
        });
    }

    startSelect(items: Array<{ label: string; value: string }>): Promise<string> {
        return new Promise((resolve) => {
            if (this.isPrompting) {
                this.isPrompting = false;
            }
            this.isSelecting = true;
            this.selectItems = items;
            this.selectResolver = resolve;
            this.emit('change');
        });
    }

    submitInput(value: string) {
        if (this.inputResolver) {
            this.isPrompting = false;
            const resolver = this.inputResolver;
            this.inputResolver = null;
            this.emit('change');
            resolver(value);
        }
    }

    submitSelect(value: string) {
        if (this.selectResolver) {
            this.isSelecting = false;
            this.selectItems = [];
            const resolver = this.selectResolver;
            this.selectResolver = null;
            this.emit('change');
            resolver(value);
        }
    }
}

export const terminalStore = new TerminalStore();
