import React, { useState } from 'react';
import { FileImage, Upload, FileText } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';

const PDFToImage: React.FC = () => {
    const { dialog, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
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

    const handleConvert = async () => {
        if (!file) return;

        try {
            setProcessing(true);
            const downloadsPath = await system.getPath('downloads');
            const outputDir = downloadsPath
                ? `${downloadsPath}/${file.split('/').pop()?.replace('.pdf', '')}_pages`
                : '.';

            const outputPaths = await pdfService.pdfToImage(file, outputDir);

            if (outputPaths && outputPaths.length > 0) {
                notification.show(`转换成功！共生成 ${outputPaths.length} 张图片`, 'success');
                // shell.openPath(outputDir); // Prevent hiding window
            }
        } catch (error: any) {
            notification.show(`转换失败: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileImage color="var(--primary-color)" /> PDF 转图片
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
                        <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                            将 PDF 的每一页转换为高质量的 PNG 图片。<br />
                            输出的图片将保存在下载目录中。
                        </p>
                    </div>

                    <button
                        onClick={handleConvert}
                        disabled={processing}
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
                            cursor: processing ? 'not-allowed' : 'pointer',
                            opacity: processing ? 0.7 : 1
                        }}
                    >
                        {processing ? '转换中...' : '开始转换'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default PDFToImage;
