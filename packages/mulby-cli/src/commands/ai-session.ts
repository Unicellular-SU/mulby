
import chalk from 'chalk';
import { SessionManager } from '../services/session-manager';

export async function sessionCommand(action: string, id: string) {
    const sessionManager = SessionManager.getInstance();

    switch (action) {
        case 'list':
            const sessions = sessionManager.listSessions();
            if (sessions.length === 0) {
                console.log('没有找到历史会话');
                return;
            }
            console.log(chalk.blue('📜 AI 生成会话历史:'));
            sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .forEach(s => {
                    const date = new Date(s.updatedAt).toLocaleString();
                    const statusColor = s.status === 'completed' ? chalk.green : (s.status === 'failed' ? chalk.red : chalk.yellow);
                    console.log(`${s.id.slice(0, 8)} | ${date} | ${statusColor(s.status)} | ${s.pluginName || '未命名'} | ${s.description.slice(0, 30)}...`);
                });
            break;

        case 'clean':
            // Logic to clean old sessions? For now maybe manually delete. 
            // Or delete specific id?
            // "clean" usually implies removing finished/old ones.
            console.log('清理功能暂未实现');
            break;

        case 'resume':
            // 动态导入，只在恢复会话时才加载 AI 相关模块
            const { aiCreate } = await import('./create/ai-create');
            if (id) {
                await aiCreate('resuming', { resume: id });
            } else {
                await aiCreate('resuming', { resume: true });
            }
            break;

        default:
            console.log(chalk.red(`未知操作: ${action}`));
    }
}
