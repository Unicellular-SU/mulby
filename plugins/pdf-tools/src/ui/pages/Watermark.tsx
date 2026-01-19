import React, { useState } from 'react';
import { Droplet, Upload, FileText } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import '../types';

const Watermark: React.FC = () => {
    const { dialog, shell, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [text, setText] = useState('Confidential');
    const [options, setOptions] = useState({
        size: 50,
        opacity: 0.5,
        color: '#ff0000',
        rotate: 45
    });
    const [processing, setProcessing] = useState(false);

    const handleSelectFile = async () => {
        const result = await dialog.showOpenDialog({
            title: '选择 PDF 文件',
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
            properties: ['openFile']
        });

        if (result && result.length > 0) {
            setFile(result[0]);
        }
    };

    const handleApply = async () => {
        if (!file || !text) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath || '.';

            const outputPath = await window.pdfApi?.watermarkPDF(file, text, options, outputDir);

            if (outputPath) {
                notification.show('水印添加成功！', 'success');
                // shell.showItemInFolder(outputPath); // Prevent hiding window
            }
        } catch (error: any) {
            notification.show(`添加水印失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Droplet color="var(--primary-color)" /> PDF 水印
            </h2>

            {!file ? (
                <div
                    onClick={handleSelectFile}
                    style={{
                        background: 'rgba(255,255,255,0.4)',
                        borderRadius: 'var(--radius-md)',
                        padding: '40px',
                        textAlign: 'center',
                        border: '2px dashed var(--glass-border)',
                        cursor: 'pointer',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}
                >
                    <Upload size={48} color="var(--primary-color)" style={{ marginBottom: '16px' }} />
                    <p>点击选择 PDF 文件</p>
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.5)',
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <FileText size={24} color="var(--primary-color)" />
                        <span style={{ fontWeight: '600' }}>{file.split('/').pop()}</span>
                        <button onClick={() => setFile(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}>更换</button>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.3)', padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>水印文字</label>
                            <input
                                type="text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--glass-border)' }}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>字号: {options.size}</label>
                                <input
                                    type="range" min="10" max="200"
                                    value={options.size}
                                    onChange={(e) => setOptions({ ...options, size: parseInt(e.target.value) })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>透明度: {options.opacity}</label>
                                <input
                                    type="range" min="0" max="1" step="0.1"
                                    value={options.opacity}
                                    onChange={(e) => setOptions({ ...options, opacity: parseFloat(e.target.value) })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>旋转: {options.rotate}°</label>
                                <input
                                    type="range" min="0" max="360"
                                    value={options.rotate}
                                    onChange={(e) => setOptions({ ...options, rotate: parseInt(e.target.value) })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}>颜色</label>
                                <input
                                    type="color"
                                    value={options.color}
                                    onChange={(e) => setOptions({ ...options, color: e.target.value })}
                                    style={{ width: '100%', height: '32px', border: 'none', padding: 0 }}
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleApply}
                        disabled={processing || !text}
                        className="glass-panel"
                        style={{
                            width: '100%',
                            padding: '16px',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--primary-color)',
                            color: 'white',
                            fontSize: '16px',
                            fontWeight: '600',
                            marginTop: 'auto',
                            cursor: processing || !text ? 'not-allowed' : 'pointer',
                            opacity: processing || !text ? 0.7 : 1
                        }}
                    >
                        {processing ? '处理中...' : '添加水印'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default Watermark;
