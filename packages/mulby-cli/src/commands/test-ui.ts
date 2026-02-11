
import chalk from 'chalk';
import { tui } from '../services/tui';

async function main() {
    console.log('Starting UI Test...');
    tui.start();

    tui.log('Welcome to Mulby CLI UI Test');
    tui.log('This line should appear in the scrollable log area.');

    let counter = 0;
    const interval = setInterval(() => {
        counter++;
        tui.log(`Auto log message #${counter} - ${new Date().toLocaleTimeString()}`);
        tui.setStatus(`Processing... (${counter}/10)`);

        if (counter >= 10) {
            clearInterval(interval);
            tui.log(chalk.green('Auto logging finished.'));
            tui.setStatus('Ready');
        }
    }, 1000);

    try {
        const name = await tui.prompt('What is your name?');
        tui.log(chalk.cyan(`Hello, ${name}!`));

        const cmd = await tui.prompt('Type a command like /help:');
        tui.log(`You typed: ${cmd}`);

        if (cmd.startsWith('/')) {
            tui.log(chalk.yellow('Command detected!'));
        }

        const confirm = await tui.prompt('Do you want to exit? (y/n)');
        if (confirm === 'y') {
            tui.log('Exiting...');
        } else {
            tui.log('Staying alive for 2 more seconds...');
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (e) {
        tui.log(chalk.red('Error during prompt: ' + e));
    } finally {
        tui.stop();
        console.log('UI Test Finished.');
        process.exit(0);
    }
}

main().catch(console.error);
