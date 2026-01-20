
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { AIMessage } from '../types/ai';

const SESSION_DIR = path.join(os.homedir(), '.intools', 'ai-sessions');

export interface FileToGenerate {
    path: string;
    description: string;
    priority: number;
}

export interface GenerationSession {
    id: string;
    pluginName: string;
    description: string;
    targetDir: string;

    plan?: {
        files: FileToGenerate[];
        dependencies: string[];
        devDependencies: string[];
    };

    status: 'planning' | 'generating' | 'completed' | 'failed';
    completedFiles: string[];
    currentFile?: string;

    conversationHistory: AIMessage[];

    createdAt: string;
    updatedAt: string;
    error?: string;
}

export class SessionManager {
    private static instance: SessionManager;

    private constructor() {
        fs.ensureDirSync(SESSION_DIR);
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    public createSession(description: string, targetDir: string): GenerationSession {
        const session: GenerationSession = {
            id: uuidv4(),
            pluginName: 'pending-name', // Will be updated after planning
            description,
            targetDir,
            status: 'planning',
            completedFiles: [],
            conversationHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.saveSession(session);
        return session;
    }

    public saveSession(session: GenerationSession) {
        session.updatedAt = new Date().toISOString();
        const filePath = path.join(SESSION_DIR, `${session.id}.json`);
        fs.writeJsonSync(filePath, session, { spaces: 2 });
    }

    public getSession(id: string): GenerationSession | null {
        const filePath = path.join(SESSION_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
            return fs.readJsonSync(filePath) as GenerationSession;
        }
        return null;
    }

    public getRecentSession(): GenerationSession | null {
        const files = fs.readdirSync(SESSION_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(SESSION_DIR, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // Latest first

        if (files.length > 0) {
            return this.getSession(files[0].name.replace('.json', ''));
        }
        return null;
    }

    public listSessions(): GenerationSession[] {
        const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
        return files.map(f => fs.readJsonSync(path.join(SESSION_DIR, f)));
    }
}
