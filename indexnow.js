#!/usr/bin/env node
// IndexNow bulk submission script
// Usage: node indexnow.js YOUR_API_KEY

const fs = require('fs');
const path = require('path');

const API_KEY = process.argv[2];
if (!API_KEY) {
  console.error('Usage: node indexnow.js YOUR_API_KEY');
  process.exit(1);
}

const DOMAIN = 'wesellvancouver.ca';
const SITEMAP_PATH = path.join(__dirname, 'dist', 'sitemap.xml');
const BATCH_SIZE = 100;

// Parse URLs from sitemap.xml
const sitemapContent = fs.readFileSync(SITEMAP_PATH, 'utf8');
const urls = [...sitemapContent.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);

console.log(`📋 Found ${urls.length} URLs in sitemap`);

async function submitBatch(batch, batchNum) {
  const body = JSON.stringify({
    host: DOMAIN,
    key: API_KEY,
    keyLocation: `https://${DOMAIN}/${API_KEY}.txt`,
    urlList: batch
  });

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body
    });

    if (res.status === 200) {
      console.log(`✅ Batch ${batchNum}: ${batch.length} URLs submitted successfully`);
    } else if (res.status === 202) {
      console.log(`⏳ Batch ${batchNum}: ${batch.length} URLs accepted (queued)`);
    } else {
      const text = await res.text();
      console.log(`⚠️  Batch ${batchNum}: status ${res.status} — ${text}`);
    }
  } catch (err) {
    console.error(`❌ Batch ${batchNum} failed:`, err.message);
  }
}

async function main() {
  console.log(`\n🚀 Submitting to IndexNow (${DOMAIN})...\n`);

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    await submitBatch(batch, batchNum);
    // Small delay between batches
    if (i + BATCH_SIZE < urls.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n✅ Done! ${urls.length} URLs submitted to IndexNow`);
  console.log(`\n📌 Make sure the key file exists at:`);
  console.log(`   https://${DOMAIN}/${API_KEY}.txt`);
}

main();
