import React, { useState } from 'react';


export default function InBrowserDemo() {
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const runDemo = async () => {
        if (!window.intools?.inbrowser) {
            addLog('Error: window.intools.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting InBrowser Demo...');

        try {
            addLog('Building chain: goto(google.com) -> when(input) -> type(uTools) -> press(Enter) -> wait(2s) -> css(bg=red)');

            const result = await window.intools.inbrowser
                .goto('https://www.google.com', {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                })
                .show()
                .viewport(1000, 800)
                .when('textarea[name="q"], input[name="q"]') // Google's search box
                .type('textarea[name="q"], input[name="q"]', 'uTools')
                .press('Enter')
                .wait(2000)
                .css('body { background: #ffebee !important; }')
                .evaluate((() => {
                    return {
                        title: document.title,
                        url: window.location.href,
                        hasResults: !!document.querySelector('#search')
                    };
                }).toString())
                .run({ width: 1000, height: 800, show: true });

            // The last element is the browser instance ID
            const meta = result.pop();
            addLog(`Result Metadata: ${JSON.stringify(meta)}`);
            addLog(`Execution Result: ${JSON.stringify(result)}`);

        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="module-container">
            <div className="module-header">
                <h1>InBrowser API Demo</h1>
            </div>

            <div className="module-content">
                <div className="control-panel" style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '20px' }}>
                    <p>This demo will open a hidden Google window, search for "uTools", change background color, and return page info.</p>
                    <button
                        className="btn-primary"
                        onClick={runDemo}
                        disabled={loading}
                        style={{
                            padding: '8px 16px',
                            background: 'var(--accent)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {loading ? 'Running...' : 'Run Automation'}
                    </button>
                </div>

                <div className="logs-panel" style={{
                    background: '#1e1e1e',
                    color: '#0f0',
                    padding: '15px',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    minHeight: '200px',
                    maxHeight: '400px',
                    overflowY: 'auto'
                }}>
                    {logs.map((log, i) => <div key={i}>{log}</div>)}
                    {logs.length === 0 && <div style={{ color: '#666' }}>Ready to run...</div>}
                </div>
            </div>
        </div>
    );
}
