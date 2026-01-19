// preload.cjs - PDF 处理 API
// 使用 CommonJS 格式，放在项目根目录，不需要打包

const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const PptxGenJS = require('pptxgenjs');
const XLSX = require('xlsx');

// Sync File Logger
const logPath = path.join(__dirname, 'debug.log');

function logToFile(message) {
    try {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logPath, logLine);
    } catch (e) {
        // ignore logging error
    }
}

// Global Error Handlers
process.on('uncaughtException', (err) => {
    logToFile(`[Uncaught Exception] ${err.stack || err}`);
});

window.addEventListener('unhandledrejection', (event) => {
    logToFile(`[Unhandled Rejection] ${event.reason}`);
});

// Singleton PDFJS Loader
let pdfjsInstance = null;
async function initPDFJS() {
    if (pdfjsInstance) return pdfjsInstance;

    try {
        logToFile('Initializing PDF.js...');
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

        if (pdfjs.GlobalWorkerOptions) {
            pdfjs.GlobalWorkerOptions.workerSrc = false;
            logToFile(`GlobalWorkerOptions.workerSrc set to false`);
        } else {
            logToFile('WARNING: GlobalWorkerOptions not found!');
        }

        pdfjsInstance = pdfjs;
        logToFile('PDF.js initialized successfully');
        return pdfjs;
    } catch (error) {
        logToFile(`Failed to initialize PDF.js: ${error.stack || error}`);
        throw error;
    }
}

// 暴露 PDF 处理 API 给渲染进程
window.pdfApi = {
    getPDFInfo: async (pdfPath) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            return {
                pageCount: pdf.getPageCount(),
                title: pdf.getTitle() || '',
                author: pdf.getAuthor() || '',
            };
        } catch (error) {
            throw new Error(`获取PDF信息失败: ${error.message}`);
        }
    },

    splitPDFByPage: async (pdfPath, outputDir, prefix = 'page') => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pageCount = pdf.getPageCount();
            const outputPaths = [];

            await fsPromises.mkdir(outputDir, { recursive: true });

            for (let i = 0; i < pageCount; i++) {
                const newPdf = await PDFDocument.create();
                const [copiedPage] = await newPdf.copyPages(pdf, [i]);
                newPdf.addPage(copiedPage);

                const newPdfBytes = await newPdf.save();
                const outputPath = path.join(outputDir, `${prefix}_${i + 1}.pdf`);
                await fsPromises.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }
            return outputPaths;
        } catch (error) {
            throw new Error(`自动拆分PDF失败: ${error.message}`);
        }
    },

    splitPDFByRanges: async (pdfPath, ranges, outputDir) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const outputPaths = [];

            await fsPromises.mkdir(outputDir, { recursive: true });

            for (const range of ranges) {
                const { start, end, name } = range;
                const newPdf = await PDFDocument.create();
                const pageIndices = [];

                for (let i = start - 1; i < end; i++) {
                    pageIndices.push(i);
                }

                const copiedPages = await newPdf.copyPages(pdf, pageIndices);
                copiedPages.forEach((page) => newPdf.addPage(page));

                const newPdfBytes = await newPdf.save();
                const fileName = name.endsWith('.pdf') ? name : `${name}.pdf`;
                const outputPath = path.join(outputDir, fileName);
                await fsPromises.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }
            return outputPaths;
        } catch (error) {
            throw new Error(`手动拆分PDF失败: ${error.message}`);
        }
    },

    mergePDFs: async (files, outputDir, fileName = 'merged.pdf') => {
        try {
            const mergedPdf = await PDFDocument.create();

            for (const file of files) {
                const fileBytes = await fsPromises.readFile(file);
                const pdf = await PDFDocument.load(fileBytes);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }

            await fsPromises.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, fileName);
            const pdfBytes = await mergedPdf.save();
            await fsPromises.writeFile(outputPath, pdfBytes);
            return outputPath;
        } catch (error) {
            throw new Error(`合并PDF失败: ${error.message}`);
        }
    },

    watermarkPDF: async (pdfPath, text, options, outputDir) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pages = pdf.getPages();
            const { size = 50, opacity = 0.5, color = '#000000', rotate = 45 } = options;

            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;

            const helveticaFont = await pdf.embedFont(StandardFonts.Helvetica);

            for (const page of pages) {
                const { width, height } = page.getSize();
                page.drawText(text, {
                    x: width / 2 - (text.length * size) / 4,
                    y: height / 2,
                    size: size,
                    font: helveticaFont,
                    color: rgb(r, g, b),
                    opacity: opacity,
                    rotate: degrees(rotate),
                });
            }

            await fsPromises.mkdir(outputDir, { recursive: true });
            const fileName = path.basename(pdfPath, '.pdf') + '_watermark.pdf';
            const outputPath = path.join(outputDir, fileName);
            const newPdfBytes = await pdf.save();
            await fsPromises.writeFile(outputPath, newPdfBytes);
            return outputPath;
        } catch (error) {
            throw new Error(`添加水印失败: ${error.message}`);
        }
    },

    pdfToImage: async (pdfPath, outputDir) => {
        try {
            logToFile(`[pdfToImage] Starting conversion for: ${pdfPath}`);
            const pdfjsLib = await initPDFJS();

            logToFile('[pdfToImage] Reading file...');
            const data = new Uint8Array(await fsPromises.readFile(pdfPath));

            logToFile('[pdfToImage] Loading document...');
            const loadingTask = pdfjsLib.getDocument({
                data,
                cMapUrl: 'node_modules/pdfjs-dist/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/'
            });

            const pdf = await loadingTask.promise;
            logToFile(`[pdfToImage] Document loaded. Pages: ${pdf.numPages}`);

            const outputPaths = [];
            await fsPromises.mkdir(outputDir, { recursive: true });

            for (let i = 1; i <= pdf.numPages; i++) {
                logToFile(`[pdfToImage] Rendering page ${i}...`);
                const page = await pdf.getPage(i);

                const viewport = page.getViewport({ scale: 2.0 });
                if (typeof document === 'undefined') {
                    throw new Error('DOM document is not available');
                }

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');
                logToFile('[pdfToImage] Canvas context created');

                await page.render({
                    canvasContext: context,
                    viewport: viewport,
                }).promise;

                logToFile(`[pdfToImage] Page ${i} rendered. Converting to blob...`);

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const buffer = new Uint8Array(await blob.arrayBuffer());

                const outputPath = path.join(outputDir, `page_${i}.png`);
                await fsPromises.writeFile(outputPath, buffer);
                outputPaths.push(outputPath);

                logToFile(`[pdfToImage] Saved page ${i}`);
                canvas.width = 0;
                canvas.height = 0;
            }

            logToFile('[pdfToImage] Complete');
            return outputPaths;
        } catch (error) {
            logToFile(`[pdfToImage] Error: ${error.stack || error}`);
            throw new Error(`PDF转图片失败: ${error.message}`);
        }
    },

    extractImages: async (pdfPath, outputDir) => {
        return window.pdfApi.pdfToImage(pdfPath, outputDir);
    },

    convertPDFToWord: async (pdfPath, outputDir) => {
        try {
            logToFile('[PDF] Starting PDF to Word...');
            const pdfjsLib = await initPDFJS();

            const data = new Uint8Array(await fsPromises.readFile(pdfPath));
            const pdf = await pdfjsLib.getDocument({ data }).promise;

            const children = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const strings = textContent.items.map(item => item.str).join(' ');

                children.push(
                    new Paragraph({
                        children: [new TextRun(strings)],
                    }),
                    new Paragraph({ text: "", pageBreakBefore: true })
                );
            }

            const doc = new Document({ sections: [{ children }] });

            await fsPromises.mkdir(outputDir, { recursive: true });
            const fileName = path.basename(pdfPath, '.pdf') + '.docx';
            const outputPath = path.join(outputDir, fileName);

            const buffer = await Packer.toBuffer(doc);
            await fsPromises.writeFile(outputPath, buffer);

            return outputPath;
        } catch (error) {
            logToFile(`[PDF] Convert Word Error: ${error.stack}`);
            throw new Error(`PDF转Word失败: ${error.message}`);
        }
    },

    convertPDFToPPT: async (pdfPath, outputDir) => {
        try {
            logToFile('[PDF] Starting PDF to PPT...');
            const pdfjsLib = await initPDFJS();

            const data = new Uint8Array(await fsPromises.readFile(pdfPath));
            const pdf = await pdfjsLib.getDocument({ data }).promise;

            const pptx = new PptxGenJS();

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const strings = textContent.items.map(item => item.str).join(' ');

                const slide = pptx.addSlide();
                slide.addText(strings, { x: 0.5, y: 0.5, w: '90%', h: '90%', fontSize: 14 });
            }

            await fsPromises.mkdir(outputDir, { recursive: true });
            const fileName = path.basename(pdfPath, '.pdf') + '.pptx';
            const outputPath = path.join(outputDir, fileName);

            await pptx.writeFile({ fileName: outputPath });

            return outputPath;
        } catch (error) {
            logToFile(`[PDF] Convert PPT Error: ${error.stack}`);
            throw new Error(`PDF转PPT失败: ${error.message}`);
        }
    },

    convertPDFToExcel: async (pdfPath, outputDir) => {
        try {
            logToFile('[PDF] Starting PDF to Excel...');
            const pdfjsLib = await initPDFJS();

            const data = new Uint8Array(await fsPromises.readFile(pdfPath));
            const pdf = await pdfjsLib.getDocument({ data }).promise;

            const rows = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const strings = textContent.items.map(item => item.str);
                rows.push(strings);
            }

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "PDF Data");

            await fsPromises.mkdir(outputDir, { recursive: true });
            const fileName = path.basename(pdfPath, '.pdf') + '.xlsx';
            const outputPath = path.join(outputDir, fileName);

            XLSX.writeFile(wb, outputPath);

            return outputPath;
        } catch (error) {
            logToFile(`[PDF] Convert Excel Error: ${error.stack}`);
            throw new Error(`PDF转Excel失败: ${error.message}`);
        }
    }
};

logToFile('Preload API loaded with File Logging');
