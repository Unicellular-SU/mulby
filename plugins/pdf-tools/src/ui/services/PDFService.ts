import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Document, Packer, Paragraph, TextRun, ImageRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';

// Set up the worker for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Helper to get window.pdfApi
const getApi = () => {
    // @ts-ignore
    const api = window.pdfApi;
    if (!api) throw new Error('PDF API is not available on window object');
    return api;
};

// Types corresponding to what we are generating
export interface ConversionProgress {
    current: number;
    total: number;
    status: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

class PDFService {
    async getDocument(pdfPath: string) {
        try {
            const api = getApi();
            const data = await api.readFile(pdfPath);
            // data from Electron preload is typically Uint8Array in renderer
            return await pdfjsLib.getDocument({
                data: data,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.530/cmaps/',
                cMapPacked: true,
            }).promise;
        } catch (e: any) {
            console.error('Failed to load PDF:', e);
            throw new Error(`无法加载PDF文件: ${e.message}`);
        }
    }

    async pdfToImage(pdfPath: string, outputDir: string, onProgress?: ProgressCallback): Promise<string[]> {
        const api = getApi();

        // 优先使用后端提取（直接从流中提取图片，解决 jsPDF 生成文件渲染白屏问题）
        try {
            // @ts-ignore
            if (api.extractPDFImages) {
                if (onProgress) onProgress({ current: 0, total: 100, status: '正在通过后端提取图片...' });
                // @ts-ignore
                const results = await api.extractPDFImages(pdfPath, outputDir);
                if (results && results.length > 0) return results;
            }
        } catch (e) {
            console.warn('Backend extraction failed, falling back to frontend...', e);
        }

        // Fallback: Frontend Rendering
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const totalPages = pdf.numPages;
        const outputPaths: string[] = [];

        console.log(`Starting PDF to Image. Pages: ${totalPages}`);

        for (let i = 1; i <= totalPages; i++) {
            if (onProgress) {
                onProgress({ current: i, total: totalPages, status: `正在转换第 ${i} 页...` });
            }

            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // High quality

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');

            if (!context) throw new Error('Canvas context could not be created');

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            } as any;
            await page.render(renderContext).promise;

            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Image creation failed');

            const buffer = await blob.arrayBuffer();

            // Path handling
            const fileName = `page_${i}.png`;
            const isWindows = outputDir.includes('\\');
            const separator = isWindows ? '\\' : '/';
            const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
            const finalPath = `${cleanDir}${separator}${fileName}`;

            await api.saveFile(finalPath, new Uint8Array(buffer));
            outputPaths.push(finalPath);
        }

        return outputPaths;
    }

    async getThumbnail(pdfPath: string): Promise<string | null> {
        const api = getApi();
        try {
            // @ts-ignore
            if (api.getPDFImagePreview) {
                // @ts-ignore
                const preview = await api.getPDFImagePreview(pdfPath);
                if (preview) return preview;
            }
        } catch (e) {
            console.warn('Backend preview failed', e);
        }

        // Fallback
        try {
            return await this.renderPageToDataURL(pdfPath, 1, 0.2);
        } catch (e) {
            console.error('Fallback preview failed', e);
            return null;
        }
    }

    async convertToWord(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const children = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str).join(' ');

            // Check if page has text content
            if (strings.trim().length > 0) {
                children.push(
                    new Paragraph({
                        children: [new TextRun(strings)],
                    }),
                    new Paragraph({ text: "", pageBreakBefore: true })
                );
            } else {
                // Fallback: Render page as image for scanned PDFs
                console.log(`Page ${i} has no text, rendering as image...`);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');

                if (context) {
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    } as any;
                    await page.render(renderContext).promise;

                    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                    if (blob) {
                        const buffer = await blob.arrayBuffer();
                        children.push(
                            new Paragraph({
                                children: [
                                    new ImageRun({
                                        data: buffer,
                                        transformation: {
                                            width: viewport.width / 2,
                                            height: viewport.height / 2,
                                        },
                                        type: "png",
                                    }),
                                ],
                            }),
                            new Paragraph({ text: "", pageBreakBefore: true }) // Add page break after image
                        );
                    }
                }
            }
        }

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);

        // Construct filename
        // Basic path parsing
        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.docx') || 'converted.docx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(buffer));
        return outputPath;
    }

    async convertToPPT(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const pptx = new PptxGenJS();

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str).join(' ');

            const slide = pptx.addSlide();

            // Check if page has text content
            if (strings.trim().length > 0) {
                slide.addText(strings, { x: 0.5, y: 0.5, w: '90%', h: '90%', fontSize: 14 });
            } else {
                // Fallback: Render page as image for scanned PDFs
                console.log(`Page ${i} has no text, rendering as image...`);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');

                if (context) {
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    } as any;
                    await page.render(renderContext).promise;

                    const dataUrl = canvas.toDataURL('image/png');
                    // PptxGenJS addImage expects base64 string or URL
                    slide.addImage({
                        data: dataUrl,
                        x: 0.5,
                        y: 0.5,
                        w: pptx.presLayout.width - 1, // Adjust width to fit slide, -1 for padding
                        h: pptx.presLayout.height - 1, // Adjust height to fit slide, -1 for padding
                        sizing: { type: 'contain', w: pptx.presLayout.width - 1, h: pptx.presLayout.height - 1 }
                    });
                }
            }
        }

        // Generate Blob
        // writeFile in browser version of pptxgenjs downloads file? 
        // We need to capture the blobs.
        // pptx.write('base64') -> returns promise with base64
        const data = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;

        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.pptx') || 'converted.pptx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(data));
        return outputPath;
    }

    async convertToExcel(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const rows = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str);
            rows.push(strings);
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "PDF Data");

        // Write to buffer
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.xlsx') || 'converted.xlsx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(wbout));
        return outputPath;
    }
    async getPageCount(pdfPath: string): Promise<number> {
        const pdf = await this.getDocument(pdfPath);
        return pdf.numPages;
    }

    async renderPageToDataURL(pdfPath: string, pageNum: number, scale = 0.5): Promise<string> {
        const pdf = await this.getDocument(pdfPath);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');

        if (!context) throw new Error('Canvas context missing');

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        } as any;
        await page.render(renderContext).promise;

        return canvas.toDataURL('image/png');
    }
}

export const pdfService = new PDFService();
