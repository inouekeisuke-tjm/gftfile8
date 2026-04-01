import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export async function processPdfs(downloadDir, propertyName, sendLog = console.log) {
    const files = await fs.readdir(downloadDir);
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    sendLog(`PDF加工プロセスを開始します（物件名: ${propertyName}）`);

    // ⑦ リネーム（指示に基づく判定ロジック）
    const getKind = (filename) => {
        const f = filename.toLowerCase();
        
        // 1. 個別リネーム対象 (⑦)
        if (f.includes('プレゼン') || f.includes('_p.pdf') || f.includes('presentation')) return 'プレゼンシート';
        if (f.includes('range_hood') || f.includes('レンジフード') || f.includes('kiki_')) return 'レンジフード';
        if (f.includes('panel_waritsuke') || f.includes('割付図') || f.includes('waritsuke')) return 'キッチンパネル推奨割付図';

        // 2. 結合対象 (⑧)
        if (f.includes('planzu') && f.includes('_k.pdf')) return 'キッチンプラン図';
        if (f.includes('planzu') && f.includes('_c.pdf')) return 'カップボードプラン図';
        if (f.includes('壁・床収まり') || f.includes('kabe_yuka')) return '壁・床収まり詳細図';
        if (f.includes('設備・配管収まり') || f.includes('setsubi_haikan')) return '設備・配管収まり詳細図';
        if (f.includes('吊戸棚収まり') || f.includes('tsuridodana')) return '吊戸棚収まり詳細図';
        if (f.includes('連結収まり') || f.includes('renketsu')) return 'キッチンカップボード連結収まり詳細図';
        if (f.includes('setsubizu') && f.includes('_k.pdf')) return 'キッチン設備図';
        if (f.includes('setsubizu') && f.includes('_c.pdf')) return 'カップボード設備図';
        if (f.includes('shiyosho') && f.includes('_k.pdf')) return 'キッチン仕様表';
        if (f.includes('shiyosho') && f.includes('_c.pdf')) return 'カップボード仕様表';
        
        // フォールバック（automation.jsの保存名からの判定）
        if (f.includes('キッチンプラン図')) return 'キッチンプラン図';
        if (f.includes('カップボードプラン図')) return 'カップボードプラン図';
        if (f.includes('キッチン設備図')) return 'キッチン設備図';
        if (f.includes('カップボード設備図')) return 'カップボード設備図';
        if (f.includes('キッチンプラン仕様表')) return 'キッチン仕様表';
        if (f.includes('カップボードプラン仕様表')) return 'カップボード仕様表';

        return null;
    };

    // ⑦ 個別ファイルのリネーム実行
    const renameMap = {
        'プレゼンシート': `プレゼンシート　${propertyName}.pdf`,
        'レンジフード': `レンジフード　${propertyName}.pdf`,
        'キッチンパネル推奨割付図': `割付詳細図　${propertyName}.pdf`
    };

    const updatedPdfFiles = await fs.readdir(downloadDir);
    for (const file of updatedPdfFiles.filter(f => f.endsWith('.pdf'))) {
        const kind = getKind(file);
        if (kind && renameMap[kind]) {
            const newName = renameMap[kind];
            const oldPath = path.join(downloadDir, file);
            const newPath = path.join(downloadDir, newName);
            try {
                await fs.rename(oldPath, newPath);
                sendLog(`リネーム成功: 【${kind}】 -> ${newName}`);
            } catch (e) {
                sendLog(`リネーム失敗: ${file}`, 'warning');
            }
        }
    }

    // ⑧ ファイルの結合
    const mergeOrder = [
        'キッチンプラン図',
        'カップボードプラン図',
        '壁・床収まり詳細図',
        '設備・配管収まり詳細図',
        '吊戸棚収まり詳細図',
        'キッチンカップボード連結収まり詳細図',
        'キッチン設備図',
        'カップボード設備図',
        'キッチン仕様表',
        'カップボード仕様表'
    ];

    const finalFilesAfterRename = await fs.readdir(downloadDir);
    const mergedPdf = await PDFDocument.create();
    const processedIndices = new Set();
    let mergeCount = 0;

    sendLog('PDFの結合（マージ）を開始します...');

    for (const targetKind of mergeOrder) {
        const matchingFiles = finalFilesAfterRename.filter(f => getKind(f) === targetKind);
        
        if (matchingFiles.length > 0) {
            // 指示⑧: 壁・床収まり詳細図の重複削除（1つだけ選ぶ）
            const filesToUse = (targetKind === '壁・床収まり詳細図') ? [matchingFiles[0]] : matchingFiles;
            
            for (const file of filesToUse) {
                try {
                    const bytes = await fs.readFile(path.join(downloadDir, file));
                    const doc = await PDFDocument.load(bytes);
                    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
                    copiedPages.forEach(page => mergedPdf.addPage(page));
                    mergeCount++;
                    sendLog(`結合中: [${targetKind}] ${file}`);
                } catch (e) {
                    sendLog(`結合エラー: ${file} (${e.message})`, 'error');
                }
            }
        }
    }

    if (mergeCount > 0) {
        const pdfBytes = await mergedPdf.save();
        const finalMergedName = `プラン図　${propertyName}.pdf`;
        const finalPath = path.join(downloadDir, finalMergedName);
        await fs.writeFile(finalPath, pdfBytes);
        sendLog(`結合完了: ${finalMergedName} (合計${mergeCount}ファイルを統合)`, 'success');
        return finalPath;
    } else {
        sendLog('結合対象のファイルが見つかりませんでした。', 'warning');
        return null;
    }
}
