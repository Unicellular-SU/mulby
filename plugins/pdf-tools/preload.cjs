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

// 暴露 PDF 处理 API 给渲染进程
window.pdfApi = {
    // === 文件 I/O 基础能力 ===
    readFile: async (filePath) => {
        try {
            return await fsPromises.readFile(filePath);
        } catch (error) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
    },

    saveFile: async (filePath, data) => {
        try {
            // Ensure directory exists
            await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
            await fsPromises.writeFile(filePath, data);
            return filePath;
        } catch (error) {
            throw new Error(`保存文件失败: ${error.message}`);
        }
    },

    openPath: async (filePath) => {
        // Only for context, might not be needed if host provides generic open
        // But keeping it simple for now if needed by UI
        const { shell } = require('electron');
        shell.openPath(filePath);
    },

    ensureDir: async (dirPath) => {
        await fsPromises.mkdir(dirPath, { recursive: true });
    },

    // === 纯 Node.js PDF 操作 (pdf-lib) ===
    // 所有的不可视化操作（拆分、合并、水印）依然在这里执行，因为 pdf-lib 在 Node 下更高效且无需渲染

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

            const saveDir = path.join(outputDir, prefix);
            await fsPromises.mkdir(saveDir, { recursive: true });

            for (let i = 0; i < pageCount; i++) {
                const newPdf = await PDFDocument.create();
                const [copiedPage] = await newPdf.copyPages(pdf, [i]);
                newPdf.addPage(copiedPage);

                const newPdfBytes = await newPdf.save();
                const outputPath = path.join(saveDir, `${prefix}_${i + 1}.pdf`);
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

    // Legacy wrappers or empty functions if frontend still calls them directly (though frontend will be updated)
    // pdfToImage, convert* functions are removed as they will be implemented in Frontend
};

logToFile('Preload API loaded (I/O Mode)');
