import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

/**
 * 1件の物件を処理する内部関数
 */
async function processSingleProperty(context, propertyInfo, sendLog, config) {
    const { name: propertyName, url: sfPropertyUrl } = propertyInfo;
    const page = await context.newPage();
    
    try {
        sendLog(`物件「${propertyName}」の処理を開始します...`);
        await page.goto(sfPropertyUrl, { waitUntil: 'load' });
        await page.waitForTimeout(3000);

        const clickInAnyFrame = async (text, label) => {
            sendLog(`${label} (${text}) を探索中...`);
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const loc = frame.locator(`text="${text}"`).first();
                    if (await loc.count() > 0) {
                        await loc.scrollIntoViewIfNeeded();
                        await loc.click();
                        return true;
                    }
                } catch (e) { continue; }
            }
            return false;
        };

        // 1. GFTタブのクリック
        const tabFound = await clickInAnyFrame("見積・受発注依頼(GFT)", "ターゲットタブ");
        if (!tabFound) {
            sendLog('「見積・受発注依頼(GFT)」が見つかりません。手動でタブを選択してください。', 'warning');
            await page.waitForTimeout(5000);
        }
        await page.waitForTimeout(2000);

        // 2. GFTメニューを表示
        let orderEmailPage;
        const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        const menuFound = await clickInAnyFrame("GFTメニューを表示", "メニュー表示ボタン");
        
        if (!menuFound) {
            sendLog('「GFTメニューを表示」が自動で見つからないため、画面を確認してください。', 'warning');
        }

        orderEmailPage = await popupPromise;
        if (!orderEmailPage) {
            sendLog('新しいタブが開かなかったため、現在のページで継続します。');
            orderEmailPage = page;
        } else {
            await orderEmailPage.waitForLoadState('networkidle');
        }

        // 3. URL抽出
        const urlRegex = /https:\/\/planning\.tjm-kitchenhouse\.jp\/graftekt\/[^\s"'<>]+/g;
        let targetUrl = null;
        for (const frame of orderEmailPage.frames()) {
            const bodyText = await frame.evaluate(() => document.body ? document.body.innerText : '');
            const urls = bodyText.match(urlRegex);
            if (urls && urls.length > 0) { targetUrl = urls[0]; break; }
        }

        if (!targetUrl) throw new Error('仕様確認表のURLを抽出できませんでした。');

        // 4. GFTポータル
        const gftPage = await context.newPage();
        await gftPage.goto(targetUrl, { waitUntil: 'networkidle' });

        if (await gftPage.locator('#login-id').count() > 0 || gftPage.url().includes('login')) {
            sendLog('GFTログインを実行します...');
            await gftPage.fill('#login-id', config.gftUser || 'gftsupport@tjmdesign.com');
            await gftPage.fill('#login-password', config.gftPass || 'azusawa343');
            await gftPage.click('button[type="submit"]');
            await gftPage.waitForLoadState('networkidle');
        }

        // 5. ダウンロード
        const downloadDir = path.join(process.cwd(), 'temp_downloads', `${Date.now()}_${propertyName.replace(/[ /\\:?*"<>|]/g, '_')}`);
        await fs.mkdir(downloadDir, { recursive: true });

        const targets = [
            'プレゼンシート', 'キッチンプラン図(PDF)', 'カップボードプラン図(PDF)', '壁・床収まり詳細図(PDF)',
            '設備・配管収まり詳細図(PDF)', '吊戸棚収まり詳細図(PDF)', 'キッチンカップボード連結収まり詳細図(PDF)',
            'キッチン設備図(PDF)', 'カップボード設備図(PDF)', 'キッチンプラン仕様表(PDF)', 'カップボードプラン仕様表(PDF)'
        ];

        const findInAllFrames = async (p, text) => {
            for (const f of p.frames()) {
                const l = f.locator(`a:has-text("${text}"), button:has-text("${text}")`).first();
                if (await l.count() > 0) return { locator: l, frame: f };
            }
            return null;
        };

        const handleDownload = async (locator, name) => {
            const [dl] = await Promise.all([
                context.waitForEvent('download', { timeout: 20000 }).catch(() => context.waitForEvent('page', { timeout: 20000 }).catch(() => null)),
                locator.click().catch(() => locator.evaluate(el => el.click()))
            ]);
            if (!dl) return null;
            if (dl.saveAs) {
                const fp = path.join(downloadDir, dl.suggestedFilename());
                await dl.saveAs(fp);
                return dl.suggestedFilename();
            } else {
                const u = dl.url();
                const res = await context.request.get(u);
                const fn = `${name}.pdf`;
                await fs.writeFile(path.join(downloadDir, fn), await res.body());
                await dl.close();
                return fn;
            }
        };

        for (const t of targets) {
            const res = await findInAllFrames(gftPage, t);
            if (res) {
                try {
                    const saved = await handleDownload(res.locator, t);
                    if (saved) sendLog(`取得成功: ${t}`);
                } catch (e) { sendLog(`取得失敗: ${t}`, 'warning'); }
            }
        }

        // 特別枠: レンジフード
        const rhXpath = 'xpath=//label[text()="レンジフード"]/following::button[contains(text(), "機器承認図(PDF)")][1]';
        for (const f of gftPage.frames()) {
            const btn = f.locator(rhXpath).first();
            if (await btn.count() > 0) {
                await handleDownload(btn, 'レンジフード');
                sendLog('取得成功: レンジフード機器承認図');
                break;
            }
        }

        sendLog(`物件「${propertyName}」の全資料取得が完了しました。`, 'success');
        await page.close();
        await gftPage.close();
        return { downloadDir, propertyName };

    } catch (e) {
        sendLog(`物件「${propertyName}」でエラーが発生しました: ${e.message}`, 'error');
        await page.close();
        return null;
    }
}

/**
 * メインエントリーポイント
 */
export async function runAutomation(sfUrl, propertyName, sendLog, waitForLogin, config = {}) {
    const browser = await chromium.launch({ 
        headless: process.env.NODE_ENV === 'production' 
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const startUrl = sfUrl || 'https://tjmdesign-kh.my.salesforce.com/00OJ3000000ZqqL';

    try {
        sendLog(`Salesforceレポートに遷移します: ${startUrl}`);
        await page.goto(startUrl);
        
        // 1. ログインチェック
        if (await page.locator('#username').count() > 0) {
            sendLog('ログイン情報を入力中...');
            await page.fill('#username', config.sfUser || 'khinouek2@tjmdesign.com');
            await page.fill('#password', config.sfPass || '071027ki');
            await page.click('#Login');
            await page.waitForTimeout(3000);
        }
        
        // 2. MFA待機
        const checkMfa = async () => {
            const url = page.url();
            return url.includes('mfa') || url.includes('identity/verification') || await page.locator('text="Identity Verification"').count() > 0;
        };

        if (await checkMfa()) {
            sendLog('【MFA待機】認証完了後に「ログイン完了を報告」を押してください。', 'warning');
            await waitForLogin();
        }
        
        await page.waitForLoadState('load');
        await page.waitForTimeout(3000);

        // 3. 物件リストの抽出 (高度なロジック)
        sendLog('レポートから物件リストを抽出しています...');
        const propertyLinks = await page.evaluate(() => {
            const prefectures = ['都', '道', '府', '県'];
            const rows = Array.from(document.querySelectorAll('table.reportTable tr'));
            const list = [];
            const seenUrls = new Set();

            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                cells.forEach((cell, idx) => {
                    const text = cell.innerText.trim();
                    // ロジックA: 「様」「邸」を直接含む
                    const link = cell.querySelector('a');
                    if (link && (link.innerText.includes('様') || link.innerText.includes('邸'))) {
                        const url = link.href;
                        if (!seenUrls.has(url)) {
                            list.push({ name: link.innerText.trim(), url: url });
                            seenUrls.add(url);
                        }
                    }
                    // ロジックB: 右隣のセルが都道府県名を含む住所
                    const nextCell = cells[idx + 1];
                    if (nextCell) {
                        const nextText = nextCell.innerText.trim();
                        const isAddress = prefectures.some(p => nextText.includes(p)) && nextText.length > 2;
                        if (isAddress && link) {
                            const url = link.href;
                            if (!seenUrls.has(url)) {
                                list.push({ name: link.innerText.trim(), url: url });
                                seenUrls.add(url);
                            }
                        }
                    }
                });
            });
            return list;
        });

        if (propertyLinks.length === 0) {
            sendLog('物件を特定できませんでした。URLを直接入力してください。', 'warning');
            if (propertyName) propertyLinks.push({ name: propertyName, url: page.url() });
            else throw new Error('物件リストを抽出できませんでした。');
        }

        sendLog(`${propertyLinks.length}件の物件を検出しました。順番に処理を開始します。`, 'success');

        const results = [];
        for (let i = 0; i < propertyLinks.length; i++) {
            sendLog(`--- [${i + 1} / ${propertyLinks.length}] ---`, 'info');
            const result = await processSingleProperty(context, propertyLinks[i], sendLog, config);
            if (result) results.push(result);
        }

        sendLog(`全${propertyLinks.length}件のうち、${results.length}件の処理が完了しました。`, 'success');
        return results;

    } catch (error) {
        sendLog(`致命的なエラー: ${error.message}`, 'error');
        throw error;
    } finally {
        // 全処理終了
    }
}
