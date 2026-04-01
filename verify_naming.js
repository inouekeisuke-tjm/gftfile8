import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { processPdfs } from './server/pdf-processor.js';

async function verify() {
    console.log('--- GFT naming simulation verification start ---');
    
    // Preparation
    const downloadDir = path.join(process.cwd(), 'temp_verification_sim');
    await fs.mkdir(downloadDir, { recursive: true });

    // Simulate GFT alphanumeric filenames
    const simFiles = [
        { name: 'GFT-20251217-0018_p.pdf', type: 'プレゼンシート' },
        { name: 'planzu_GFT-20251217-0018_k.pdf', type: 'キッチンプラン図' },
        { name: 'setsubizu_GFT-20251217_k.pdf', type: 'キッチン設備図' },
        { name: 'shiyosho_GFT-20251217_k.pdf', type: 'キッチン仕様表' },
        { name: 'kiki_range_hood_01.pdf', type: 'レンジフード' }
    ];

    // Create dummy PDF files
    const dummyContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    
    for (const f of simFiles) {
        await fs.writeFile(path.join(downloadDir, f.name), dummyContent);
        console.log(`Simulated: ${f.name} -> expected kind: ${f.type}`);
    }

    // Execution
    const propertyName = '検証物件A';
    try {
        console.log(`Processing with property name: ${propertyName}...`);
        const finalPath = await processPdfs(downloadDir, propertyName);
        console.log(`Success! Merged file: ${finalPath}`);

        // Result check
        const filesAfter = await fs.readdir(downloadDir);
        console.log('\nFiles in directory after processing:');
        filesAfter.forEach(f => console.log(` - ${f}`));
        
    } catch (e) {
        console.error(`Verification failed: ${e.message}`);
    }
}

verify();
