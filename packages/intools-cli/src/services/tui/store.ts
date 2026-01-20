import { EventEmitter } from 'events';

class TerminalStore extends EventEmitter {
    public logs: string[] = [];
    public isPrompting: boolean = false;
    public statusMessage: string = '';
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
            this.isPrompting = true;
            this.inputResolver = resolve;
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
}

export const terminalStore = new TerminalStore();
