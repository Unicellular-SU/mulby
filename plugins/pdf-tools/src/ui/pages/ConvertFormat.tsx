import React, { useState } from 'react';
import { FileText, Presentation, Sheet, FileQuestion, Upload } from 'lucide-react';
import { useIntools } from '../hooks/useIntools';
import { pdfService } from '../services/PDFService';
import '../types';

interface ConvertFormatProps {
    type: 'word' | 'ppt' | 'excel';
}

const ConvertFormat: React.FC<ConvertFormatProps> = ({ type }) => {
    const { dialog, shell, notification, system } = useIntools('pdf-tools');
    const [file, setFile] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);

    const titles = {
        word: 'PDF 转 Word',
        ppt: 'PDF 转 PPT',
        excel: 'PDF 转 Excel'
    };

    const getIcon = () => {
        switch (type) {
            case 'word': return <FileText size={24} color="var(--primary-color)" />;
            case 'ppt': return <Presentation size={24} color="var(--primary-color)" />;
            case 'excel': return <Sheet size={24} color="var(--primary-color)" />;
            default: return <FileQuestion size={24} color="var(--primary-color)" />;
        }
    };

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
            const outputDir = downloadsPath || '.';

            let outputPath;
            switch (type) {
                case 'word':
                    outputPath = await pdfService.convertToWord(file, outputDir);
                    break;
                case 'ppt':
                    outputPath = await pdfService.convertToPPT(file, outputDir);
                    break;
                case 'excel':
                    outputPath = await pdfService.convertToExcel(file, outputDir);
                    break;
            }

            if (outputPath) {
                notification.show('转换成功！', 'success');
                shell.showItemInFolder(outputPath);
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
                {getIcon()} {titles[type]}
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
                            注意：转换效果取决于 PDF 源文件的结构。<br />
                            扫描件或复杂版式可能无法完美还原。
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

export default ConvertFormat;
