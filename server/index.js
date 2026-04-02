import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

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

        const baseDest = (config && config.downloadPath) 
            ? config.downloadPath 
            : (process.env.NODE_ENV === 'production' 
                ? '/tmp/downloads' 
                : path.join(process.env.USERPROFILE || process.env.HOME || '/tmp', 'Downloads'));

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

        sendLog(`全工程が完了しました。成功: ${successCount} / ${automationResults.length} 件`, 'success');
        sendLog(`保存先: ${baseDest}`, 'info');
        
    } catch (error) {
        sendLog(`エラーが発生しました: ${error.message}`, 'error');
    }
});

// For any other request, serve index.html (SPA support)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/events') return next();
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
