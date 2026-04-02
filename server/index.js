import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fsSync from 'fs';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, '../dist')));

// SSE for real-time logging
let clients = [];
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

function sendLog(message, type = 'info') {
    const data = JSON.stringify({ message, type, timestamp: new Date().toLocaleTimeString() });
    clients.forEach(c => c.res.write(`data: ${data}\n\n`));
    console.log(`[${type.toUpperCase()}] ${message}`);
}

import { runAutomation } from './automation.js';
import { processPdfs } from './pdf-processor.js';
import fs from 'fs/promises';

const downloadableFiles = new Map();

let loginResolver;

app.post('/api/login-complete', (req, res) => {
    if (loginResolver) {
        loginResolver();
        loginResolver = null;
        res.json({ success: true, message: 'ログイン完了信号を受信しました' });
    } else {
        res.status(400).json({ success: false, message: '待機中のプロセスがありません' });
    }
});

app.post('/api/start', async (req, res) => {
    const { sfUrl, propertyName, config } = req.body;
    
    if (!sfUrl) {
        return res.status(400).json({ error: 'Salesforce URL is required' });
    }

    res.json({ status: 'started' });

    try {
        sendLog(`自動実行を開始します...`);
        
        // 1. Run Automation (Download PDFs for multiple properties)
        const waitForLogin = () => new Promise(resolve => { loginResolver = resolve; });
        
        // runAutomation now returns an array of { downloadDir, propertyName }
        const automationResults = await runAutomation(sfUrl, propertyName, sendLog, waitForLogin, config);
        
        if (!automationResults || automationResults.length === 0) {
            throw new Error('処理対象の物件が見つかりませんでした。');
        }

        const sessionId = Date.now().toString();
        const baseDest = (config && config.downloadPath) 
            ? path.join(config.downloadPath, `GFT_${sessionId}`)
            : (process.env.NODE_ENV === 'production' 
                ? `/tmp/downloads_${sessionId}` 
                : path.join(process.env.USERPROFILE || process.env.HOME || '/tmp', `GFT_Downloads_${sessionId}`));

        let successCount = 0;

        for (const res of automationResults) {
            const { downloadDir, propertyName: finalPropertyName } = res;
            
            try {
                sendLog(`--- [${finalPropertyName}] の後処理を開始 ---`);
                
                // 2. Process PDFs (Rename & Merge)
                sendLog(`PDF加工中 (${finalPropertyName} としてリネームおよび結合)...`);
                await processPdfs(downloadDir, finalPropertyName, sendLog);
                
                // 3. Move all processed files to target folder (with property subfolder)
                // Sanitize property name for folder (remove invalid chars)
                const sanitizedFolderName = finalPropertyName.replace(/[\\/:*?"<>|]/g, '_').trim();
                const finalDest = path.join(baseDest, sanitizedFolderName);
                
                sendLog(`保存先フォルダに移動しています: ${finalDest}`);
                
                // Ensure destination subfolder exists
                await fs.mkdir(finalDest, { recursive: true });

                const processedFiles = await fs.readdir(downloadDir);
                for (const file of processedFiles) {
                    if (file.endsWith('.pdf')) {
                        const src = path.join(downloadDir, file);
                        const dst = path.join(finalDest, file);
                        await fs.copyFile(src, dst);
                    }
                }
                
                successCount++;
                sendLog(`物件「${finalPropertyName}」の全工程が完了しました。`, 'success');
                
                // Clean up temporary download dir
                try {
                    await fs.rm(downloadDir, { recursive: true, force: true });
                } catch (e) {
                    console.error(`Temp directory cleanup failed: ${downloadDir}`, e);
                }

            } catch (err) {
                sendLog(`物件「${finalPropertyName}」の後処理でエラーが発生しました: ${err.message}`, 'error');
            }
        }

        if (successCount > 0) {
            sendLog(`ZIPファイルの作成を開始します...`);
            const zipFileName = `GFT_Results_${sessionId}.zip`;
            // Zip is created in the parent folder of baseDest
            const zipFilePath = path.join(path.dirname(baseDest), zipFileName);
            
            await new Promise((resolve, reject) => {
                const output = fsSync.createWriteStream(zipFilePath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                output.on('close', resolve);
                archive.on('error', reject);

                archive.pipe(output);
                archive.directory(baseDest, 'GFT_Results');
                archive.finalize();
            });

            sendLog(`ZIPファイルの作成が完了しました。ダウンロードを開始します！`, 'success');
            
            // Register file for download
            downloadableFiles.set(zipFileName, zipFilePath);

            // Send trigger to frontend
            const downloadUrl = `/api/download/${zipFileName}`;
            clients.forEach(c => c.res.write(`data: ${JSON.stringify({ type: 'download_link', url: downloadUrl, message: 'ダウンロードを要求しました' })}\n\n`));
            
            // Clean up the initial unzipped folder since we have the zip
            try {
                await fs.rm(baseDest, { recursive: true, force: true });
            } catch (e) {
                console.error('Failed to cleanup baseDest', e);
            }
        }

    } catch (error) {
        sendLog(`エラーが発生しました: ${error.message}`, 'error');
    }
});

// Download Route for generated ZIP
app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = downloadableFiles.get(filename);
    
    if (!filePath) {
        return res.status(404).send('File not found or expired');
    }

    res.download(filePath, filename, (err) => {
        if (!err) {
            // Delete the zip file after successful download to save memory
            fs.rm(filePath, { force: true }).catch(console.error);
            downloadableFiles.delete(filename);
        }
    });
});

// For any other request, serve index.html (SPA support)
app.use((req, res, next) => {
    // Exclude API and SSE routes
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/events') {
        return next();
    }
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
