import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { processPdfs } from './server/pdf-processor.js';

async function verify() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    try {
        console.log('--- Full Implementation Verification Start ---');
        
        // 1. GFT Login
        await page.goto('https://planning.tjm-kitchenhouse.jp/graftekt/login/');
        await page.fill('#login-id', 'gftsupport@tjmdesign.com');
        await page.fill('#login-password', 'azusawa343');
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle');

        const planUUID = '34c57305-eb6f-4a1a-afdf-64ef1c4572e2';
        const specUrl = `https://planning.tjm-kitchenhouse.jp/graftekt/plan/specification/?planUUID=${planUUID}`;
        console.log(`Target Plan: ${specUrl}`);
        await page.goto(specUrl, { waitUntil: 'networkidle' });

        const downloadDir = path.join(process.cwd(), 'temp_verification');
        await fs.mkdir(downloadDir, { recursive: true });

        // List of files to download
        const targets = [
            { name: 'プレゼンシート', type: 'link' },
            { name: 'キッチンプラン図(PDF)', type: 'link' },
            { name: 'キッチン設備図(PDF)', type: 'link' },
            { name: 'キッチンプラン仕様表(PDF)', type: 'link' },
            { name: 'カップボードプラン図(PDF)', type: 'link' },
            { name: 'カップボード設備図(PDF)', type: 'link' },
            { name: 'カップボードプラン仕様表(PDF)', type: 'link' }
        ];

        for (const target of targets) {
            const link = page.locator(`a:has-text("${target.name}")`).first();
            if (await link.count() > 0) {
                try {
                    console.log(`Downloading: ${target.name}...`);
                    const [download] = await Promise.all([
                        page.waitForEvent('download', { timeout: 15000 }),
                        link.click()
                    ]);
                    await download.saveAs(path.join(downloadDir, download.suggestedFilename()));
                } catch (e) {
                    console.log(`  Failed to download ${target.name}: ${e.message}`);
                }
            } else {
                console.log(`  Not found: ${target.name}`);
            }
        }

        // Special Case: Range Hood (機器承認図)
        // Find "レンジフード" section and then the "機器承認図(PDF)" button
        console.log('Checking for Range Hood Drawing...');
        const rangeHoodSection = page.locator('.component:has-text("レンジフード")');
        if (await rangeHoodSection.count() > 0) {
            const rangeHoodButton = rangeHoodSection.locator('button:has-text("機器承認図(PDF)")').first();
            if (await rangeHoodButton.count() > 0) {
                try {
                    const [download] = await Promise.all([
                        page.waitForEvent('download', { timeout: 15000 }),
                        rangeHoodButton.click()
                    ]);
                    const filename = `レンジフード_${download.suggestedFilename()}`;
                    await download.saveAs(path.join(downloadDir, filename));
                    console.log(`  Downloaded Range Hood Drawing: ${filename}`);
                } catch (e) {
                    console.log(`  Failed to download Range Hood Drawing: ${e.message}`);
                }
            } else {
                console.log('  Range Hood drawing button not found in section.');
            }
        } else {
            console.log('  Range Hood section not found.');
        }

        // Special Case: Kitchen Panel (割付図)
        const panelLink = page.locator('a:has-text("キッチンパネル推奨割付図(PDF)")').first();
        if (await panelLink.count() > 0) {
            try {
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 15000 }),
                    panelLink.click()
                ]);
                await download.saveAs(path.join(downloadDir, download.suggestedFilename()));
                console.log(`  Downloaded Kitchen Panel Drawing: ${download.suggestedFilename()}`);
            } catch (e) { console.log('  Failed Panel download'); }
        }

        // 4. Processing
        console.log('Applying Rename & Merge Rules...');
        const propertyName = '中村亮介 様邸';
        const finalPath = await processPdfs(downloadDir, propertyName);

        console.log(`\nVerification Complete!`);
        console.log(`Output: ${finalPath}`);
        
        // List final files in Downloads simulated folder
        const files = await fs.readdir(downloadDir);
        console.log('\nFinal Files:');
        files.forEach(f => console.log(` - ${f}`));

    } catch (e) {
        console.error(`Verification Critical Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}

verify();
