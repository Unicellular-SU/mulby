import { useState } from 'react';


export default function InBrowserDemo() {
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const runDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting InBrowser Demo...');

        try {
            addLog('Building chain: goto(google.com) -> when(input) -> type(uTools) -> press(Enter) -> wait(2s) -> css(bg=red)');

            const result = await window.mulby.inbrowser
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
    }

    const runP1Demo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Priority 1 Features Demo...');

        try {
            addLog('Chain: goto(google) -> devTools -> value(search) -> scroll(y) -> evaluate(add check) -> check -> wait');

            const result = await window.mulby.inbrowser
                .goto('https://www.google.com')
                .show()
                .devTools('right') // Test devTools
                .wait(1000)
                .value('textarea[name="q"], input[name="q"]', 'Priority 1 Features Test') // Test value
                .scroll(500) // Test global scroll
                .evaluate((() => {
                    // Inject a checkbox to test check()
                    const div = document.createElement('div');
                    div.style.position = 'fixed';
                    div.style.top = '100px';
                    div.style.left = '100px';
                    div.style.zIndex = '9999';
                    div.style.background = 'white';
                    div.style.padding = '20px';
                    div.innerHTML = '<input type="checkbox" id="test-check"> Test Checkbox';
                    document.body.appendChild(div);
                }).toString())
                .wait(1000)
                .check('#test-check', true) // Test check
                .wait(2000)
                .run({ width: 1000, height: 800, show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const runP2Demo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Priority 2 Features Demo...');

        try {
            addLog('Chain: useragent(CustomUA) -> goto(google) -> focus(search) -> paste(P2 Test) -> evaluate(get UA) -> wait -> end');

            const customUA = 'Mozilla/5.0 (Priority2Test/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

            const result = await window.mulby.inbrowser
                .useragent(customUA) // Test useragent
                .goto('https://www.google.com')
                .show()
                .wait(1000)
                .focus('textarea[name="q"], input[name="q"]') // Test focus
                .wait(500)
                .paste('Priority 2 Features Test') // Test paste
                .wait(1000)
                .evaluate((() => {
                    return {
                        ua: navigator.userAgent,
                        value: (document.querySelector('textarea[name="q"], input[name="q"]') as any)?.value
                    };
                }).toString())
                .wait(2000)
                .end() // Test end
                .run({ width: 1000, height: 800, show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
            addLog('Browser should be closed manually via .end()');
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const runP3Demo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Priority 3 Features Demo...');

        try {
            addLog('Chain: device(iPhone X) -> goto(google) -> mousedown(logo) -> mouseup(logo) -> evaluate(check dimensions/UA) -> wait -> end');

            const result = await window.mulby.inbrowser
                .device('iPhone X') // Test device
                .goto('https://www.google.com')
                .show()
                .wait(1000)
                // Google logo on mobile might be different, let's just click body or a known element
                // Mobile google usually has a logo with id 'hplogo' or similar, or we can just click body.
                // Let's click the search button area if visible, or just check dimensions.
                .evaluate((() => {
                    return {
                        ua: navigator.userAgent,
                        width: window.innerWidth,
                        height: window.innerHeight,
                        isMobile: /iPhone/.test(navigator.userAgent)
                    };
                }).toString())
                .wait(2000)
                .end()
                .run({ show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
            addLog('Browser should look like iPhone X');
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const runBaiduMapDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Baidu Map Demo...');

        const address = "福州烟台山";

        try {
            addLog(`Searching for: ${address} on Baidu Map`);

            const result = await window.mulby.inbrowser
                .goto("https://map.baidu.com")
                .show() // Ensure window is visible
                .wait(1000) // Wait for page load
                .value("#sole-input", address) // using .value() as .input() replacement
                .wait(300)
                .press("Enter") // "enter" -> "Enter"
                .run({ width: 1200, height: 800, show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const runIframeDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Iframe Demo...');
        addLog('Note: This will likely fail with timeout if the target URL is not accessible.');
        addLog('Target: iframe#outer >> iframe#inner >> button.login');

        try {
            const result = await window.mulby.inbrowser
                .goto('https://container.iframe.test.web')
                // Wait for button inside nested iframes
                .wait("iframe#outer >> iframe#inner >> button.login")
                // Click it
                .click("iframe#outer >> iframe#inner >> button.login")
                .run({ width: 1200, height: 800, show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            // This is expected if the URL doesn't exist
        } finally {
            setLoading(false);
        }

    }

    const runCloudDriveDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Cloud Drive Demo...');

        const text = `https://pan.baidu.com/s/1ekPm-ooS0uvVA_J7ZqVGDQ 提取码: kvr5`;
        const matchs = text.match(/(https?:\/\/[a-z0-9-._~:/?=#]+)\s*(?:\(|（)?(?:提取密?码?|访问密?码|密码)\s*(?::|：)?\s*([a-z0-9]{4,6})/i);

        if (!matchs) {
            addLog('Error: Failed to parse URL and code');
            setLoading(false);
            return;
        }

        const url = matchs[1];
        const code = matchs[2];

        addLog(`Target URL: ${url}`);
        addLog(`Extraction Code: ${code}`);

        try {
            const result = await window.mulby.inbrowser
                .clearCookies(url)
                .goto(url)
                .show() // Ensure visible
                .wait("input")
                .focus("//input[contains(@placeholder, '提取码') or contains(@placeholder, '访问码')]") // XPath
                .input(code) // New input method
                .wait(300)
                .press("Enter")
                .run({ width: 1200, height: 800, show: true });

            addLog(`Result: ${JSON.stringify(result)}`);
        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            // Expected if URL invalid or element not found
        } finally {
            setLoading(false);
        }
    }

    const runNewFeaturesDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting New Features Demo (dblclick, hover, markdown, screenshot)...');

        try {
            const result = await window.mulby.inbrowser
                .goto('https://www.google.com')
                .show()
                .wait(1000)
                .hover('div') // Generic hover
                .wait(500)
                .dblclick('body') // Generic dblclick
                .wait(500)
                .markdown('body') // Test markdown
                .screenshot('body', null) // Test screenshot (return buffer)
                // Test drop (simulated)
                .drop('textarea[name="q"], input[name="q"]', '/Users/su/Downloads/screenshot-1768318296924.png')
                .run({ width: 800, height: 600, show: true });

            const md = result[0];
            const img = result[1];

            addLog(`Markdown length: ${md ? md.length : 0}`);
            addLog(`Screenshot size: ${img ? img.length : 0} bytes`);
            addLog(`Result: ${JSON.stringify(result)}`);

        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const runFinalGapDemo = async () => {
        if (!window.mulby?.inbrowser) {
            addLog('Error: window.mulby.inbrowser not found');
            return;
        }

        setLoading(true);
        setLogs([]);
        addLog('Starting Final Gap Features Demo...');

        try {
            // Test Manager Methods
            addLog('Testing Manager Methods...');
            const idles = await window.mulby.inbrowser.getIdleInBrowsers();
            addLog(`Idle Windows: ${idles.length}`);

            await window.mulby.inbrowser.clearInBrowserCache();
            addLog('Cache cleared');

            // Test Ops
            const downloadsPath = await window.mulby.system.getPath('downloads');
            const savePath = `${downloadsPath}/mulby-test-${Date.now()}.pdf`;

            addLog(`Chain: goto(google) -> css(bg=blue) -> press(A) -> pdf(${savePath}) -> end`);
            const result = await window.mulby.inbrowser
                .goto('https://www.google.com')
                .show()
                .wait(1000)
                .css('body { background: #e3f2fd !important; }') // Test CSS
                .wait(500)
                .focus('textarea[name="q"], input[name="q"]')
                .press('A', ['shift']) // Test Press with modifier
                .wait(500)
                .pdf({ printBackground: true }, savePath) // Test PDF with save path
                .end()
                .run({ width: 800, height: 600, show: true });

            addLog(`PDF Saved to: ${savePath}`);
            addLog(`Result: ${JSON.stringify(result.map((r: any) => (r && r.length > 100) ? '[Big Data]' : r))}`);

        } catch (error: any) {
            addLog(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="module-container">
            <div className="module-header">
                <h1>InBrowser API Demo</h1>
            </div>

            <div className="module-content">
                <div className="control-panel" style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '20px', display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                        <p>Standard Demo: Search Google & Get Title</p>
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
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run Standard Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Priority 1 Demo: Value, Check, Scroll, DevTools</p>
                        <button
                            className="btn-primary"
                            onClick={runP1Demo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#2196F3',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run P1 Features Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Priority 2: UserAgent, Focus, Paste, End</p>
                        <button
                            className="btn-primary"
                            onClick={runP2Demo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#9C27B0',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run P2 Features Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Priority 3: Device, MouseDown/Up</p>
                        <button
                            className="btn-primary"
                            onClick={runP3Demo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#FF9800',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run P3 Features Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Baidu Map Demo (User Request)</p>
                        <button
                            className="btn-primary"
                            onClick={runBaiduMapDemo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#E91E63',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run Baidu Map Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Iframe Demo (User Request)</p>
                        <button
                            className="btn-primary"
                            onClick={runIframeDemo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#9C27B0',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run Iframe Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Cloud Drive Demo (User Request)</p>
                        <button
                            className="btn-primary"
                            onClick={runCloudDriveDemo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#3F51B5',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run Cloud Drive Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>New Features (dblclick, hover, md, screen)</p>
                        <button
                            className="btn-primary"
                            onClick={runNewFeaturesDemo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#009688',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run New Features Demo
                        </button>
                    </div>
                    <div style={{ flex: 1 }}>
                        <p>Final Gap Features (css, press, pdf, manager)</p>
                        <button
                            className="btn-primary"
                            onClick={runFinalGapDemo}
                            disabled={loading}
                            style={{
                                padding: '8px 16px',
                                background: '#607D8B',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                width: '100%'
                            }}
                        >
                            Run Final Gap Demo
                        </button>
                    </div>
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
