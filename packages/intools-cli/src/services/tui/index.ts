import React from 'react';
import { render, Instance } from 'ink';
import { TerminalApp } from '../../ui/Terminal';
import { terminalStore } from './store';

export class TerminalService {
    private static instance: TerminalService;
    private inkInstance: Instance | null = null;

    private constructor() {
        // Private constructor
    }

    public static getInstance(): TerminalService {
        if (!TerminalService.instance) {
            TerminalService.instance = new TerminalService();
        }
        return TerminalService.instance;
    }

    public start() {
        if (!this.inkInstance) {
            // Need to use createElement for React 17+ / Ink 3+
            this.inkInstance = render(React.createElement(TerminalApp));
        }
    }

    public stop() {
        if (this.inkInstance) {
            this.inkInstance.unmount();
            this.inkInstance = null;
        }
    }

    public log(message: string) {
        // Strip ANSI codes if needed, or keep them if Text supports it (Ink supports Chalk)
        terminalStore.addLog(message);
    }

    public async prompt(message: string): Promise<string> {
        this.log(message); // Log the question
        return await terminalStore.startPrompt();
    }

    public setStatus(message: string) {
        terminalStore.setStatus(message);
    }
}

export const tui = TerminalService.getInstance();
