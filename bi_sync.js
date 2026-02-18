const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");

// Mongo URI беремо з Railway secrets
const MONGO_URI = process.env.MONGO_URI;

// === Downloader ===
// Тут ми будемо качати Excel з Prozorro BI через headless браузер (Playwright/Selenium).
const { chromium } = require('playwright');

async function downloadProzorroBI(url, filename) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // відкриваємо BI‑фрейм
  await page.goto(url, { waitUntil: 'networkidle' });

  // чекаємо поки з’явиться кнопка "Export"
  await page.waitForSelector('button:has-text("Export")');

  // клікаємо "Export"
  await page.click('button:has-text("Export")');

  // клікаємо "Excel"
  await page.click('button:has-text("Excel")');

  // чекаємо завантаження файлу
  const download = await page.waitForEvent('download');
  await download.saveAs(filename);

  await browser.close();
  console.log(`Файл збережено як ${filename}`);
  return filename;
}


// === Deduplicator ===
async function deduplicate(newData, collection) {
  const existingIds = await collection.distinct("ID");
  return newData.filter(item => !existingIds.includes(item.ID));
}

// === Enricher ===
function enrich(data) {
  return data.map(item => ({
    ...item,
    enriched: `info_for_${item.ЄДРПОУ}`
  }));
}

// === Sync to MongoDB ===
async function syncToMongo(data, collectionName) {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db("prozorro");
  const collection = db.collection(collectionName);

  for (const rec of data) {
    await collection.updateOne({ ID: rec.ID }, { $set: rec }, { upsert: true });
  }

  console.log(`Синхронізовано ${data.length} записів у ${collectionName}`);
  await client.close();
}

// === Main ===
async function main() {
  const urls = {
    forecast: "https://bi.prozorro.org/single/?appid=7fa5749b-3186-48c2-80bf-4e9e49f1d71a&obj=yXDpjY&theme=sense&opt=ctxmenu,currsel&select=AltSelState::_Language,EN&select=$::_Language,UA&select=$::%D0%9A%D0%BB%D0%B0%D1%81%20CPV,33690000-3%20%D0%9B%D1%96%D0%BA%D0%B0%D1%80%D1%81%D1%8C%D0%BA%D1%96%20%D0%B7%D0%B0%D1%81%D0%BE%D0%B1%D0%B8%20%D1%80%D1%96%D0%B7%D0%BD%D1%96,38430000-8%20%D0%94%D0%B5%D1%82%D0%B5%D0%BA%D1%82%D0%BE%D1%80%D0%B8%20%D1%82%D0%B0%20%D0%B0%D0%BD%D0%B0%D0%BB%D1%96%D0%B7%D0%B0%D1%82%D0%BE%D1%80%D0%B8&select=AltSelState::_DimPlansNo,0" ,
    contracts: "https://bi.prozorro.org/single/?appid=2595af2b-985f-4771-aa36-2133e1f89df0&obj=RRQjLpj&theme=sense&opt=ctxmenu,currsel&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CompExpressionNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CompDimensionNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_KPIShowType,abs&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_KPIShow,0&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CTPK,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_DimPrevDaysNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_DBKPINo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_Language,UA&select=AltSelState::_CompExpressionNo,1&select=AltSelState::_CompDimensionNo,1&select=AltSelState::_KPIShowType,%25&select=AltSelState::_KPIShow,1&select=AltSelState::_CTPK,1&select=AltSelState::_DimPrevDaysNo,1&select=AltSelState::_DBKPINo,1&select=AltSelState::_Language,EN&select=$::_CompExpressionNo,1&select=$::_CompDimensionNo,1&select=$::_KPIShowType,abs&select=$::_KPIShow,0&select=$::_CTPK,1&select=$::_DimPrevDaysNo,1&select=$::_DBKPINo,1&select=$::_Language,UA&select=$::%D0%9A%D0%BB%D0%B0%D1%81%20CPV%20%D0%BB%D0%BE%D1%82%D0%B0%20(%D0%B0%D0%B3%D1%80%D0%B5%D0%B3%D0%BE%D0%B2%D0%B0%D0%BD%D0%BE),33690000-3%20%D0%9B%D1%96%D0%BA%D0%B0%D1%80%D1%81%D1%8C%D0%BA%D1%96%20%D0%B7%D0%B0%D1%81%D0%BE%D0%B1%D0%B8%20%D1%80%D1%96%D0%B7%D0%BD%D1%96,38430000-8%20%D0%94%D0%B5%D1%82%D0%B5%D0%BA%D1%82%D0%BE%D1%80%D0%B8%20%D1%82%D0%B0%20%D0%B0%D0%BD%D0%B0%D0%BB%D1%96%D0%B7%D0%B0%D1%82%D0%BE%D1%80%D0%B8&select=$::%D0%A0%D1%96%D0%BA,2023,2024,2025&select=AltSelState::_NewDimOrgsNo,0"
  };

  for (const [name, url] of Object.entries(urls)) {
    const filename = `${name}.xlsx`;
    await downloadProzorroBI(url, filename);

    // TODO: розпарсити Excel у JSON (через xlsx або exceljs)
    const newData = [
      { ID: "123", ЄДРПОУ: "00123456" },
      { ID: "124", ЄДРПОУ: "00987654" }
    ];

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db("prozorro");
    const collection = db.collection(`labs_${name}`);

    const cleanData = await deduplicate(newData, collection);
    const enrichedData = enrich(cleanData);
    await syncToMongo(enrichedData, `labs_${name}`);

    await client.close();
  }
}

main().catch(err => console.error(err));
