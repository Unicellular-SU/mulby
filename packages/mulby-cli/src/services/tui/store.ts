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
            // 如果已有未完成的 prompt，先用空字符串 resolve 它
            if (this.inputResolver) {
                const oldResolver = this.inputResolver;
                this.inputResolver = null;
                oldResolver('');
            }
            // 如果正在选择，取消选择并 resolve
            if (this.isSelecting && this.selectResolver) {
                const oldResolver = this.selectResolver;
                this.selectResolver = null;
                this.isSelecting = false;
                this.selectItems = [];
                oldResolver('');
            }
            this.isPrompting = true;
            this.inputResolver = resolve;
            this.emit('change');
        });
    }

    startSelect(items: Array<{ label: string; value: string }>): Promise<string> {
        return new Promise((resolve) => {
            // 如果已有未完成的 select，先用空字符串 resolve 它
            if (this.selectResolver) {
                const oldResolver = this.selectResolver;
                this.selectResolver = null;
                oldResolver('');
            }
            // 如果正在 prompt，取消 prompt 并 resolve
            if (this.isPrompting && this.inputResolver) {
                const oldResolver = this.inputResolver;
                this.inputResolver = null;
                this.isPrompting = false;
                oldResolver('');
            }
            this.isSelecting = true;
            this.selectItems = items;
            this.selectResolver = resolve;
            this.emit('change');
        });
    }

    submitInput(value: string) {
        if (this.inputResolver) {
            // Echo input to logs to simulate terminal history
            // We use a specific style to indicate it's user input (e.g. green arrow)
            // But since 'chalk' might not be imported, let's just use raw string or rely on the caller?
            // Actually, best to import chalk here. 
            // Since we cannot easily add imports at the top with this tool without rewriting the whole file or using multi_replace (which is fine),
            // I will assume chalk is available or use a simple string if I can't import easily.
            // Wait, I can rewrite the import section too if I include it in the range or just rewrite the file.
            // But 'chalk' is used comprehensively in this project.

            // To avoid complex partial replace issues with imports, I'll just rewrite the whole file 
            // or use multi_replace to add import. 
            // LIMITATION: replace_file_content works on a contiguous block. 
            // I will use `replace_file_content` to replace the methods, but I need `chalk`.
            // Let's check if I can just use ANSI codes? No, better use chalk.
            // I'll rewrite the whole file to add the import safely.

            this.addLog(`\x1b[32m✔\x1b[0m ${value}`); // Green checkmark + value using raw ANSI for simplicity if avoiding full rewrite, or just do full rewrite.

            this.isPrompting = false;
            const resolver = this.inputResolver;
            this.inputResolver = null;
            this.emit('change');
            resolver(value);
        }
    }

    submitSelect(value: string) {
        if (this.selectResolver) {
            const selectedItem = this.selectItems.find(i => i.value === value);
            const label = selectedItem ? selectedItem.label : value;
            this.addLog(`\x1b[32m✔\x1b[0m \x1b[36m${label}\x1b[0m`); // Green check + Cyan label

            this.isSelecting = false;
            this.selectItems = [];
            const resolver = this.selectResolver;
            this.selectResolver = null;
            this.emit('change');
            resolver(value);
        }
    }

    /**
     * 清理所有等待中的 Promise，防止进程挂起
     */
    cleanup() {
        if (this.inputResolver) {
            const resolver = this.inputResolver;
            this.inputResolver = null;
            this.isPrompting = false;
            resolver('');
        }
        if (this.selectResolver) {
            const resolver = this.selectResolver;
            this.selectResolver = null;
            this.isSelecting = false;
            this.selectItems = [];
            resolver('');
        }
        this.removeAllListeners();
    }
}

export const terminalStore = new TerminalStore();
