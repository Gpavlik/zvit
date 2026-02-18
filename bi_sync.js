const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");

// Mongo URI беремо з Railway secrets
const MONGO_URI = process.env.MONGO_URI;

// === Downloader ===
// Тут ми будемо качати Excel з Prozorro BI через headless браузер (Playwright/Selenium).
const { chromium } = require('playwright');
const XLSX = require('xlsx');

async function downloadProzorroBI(url, filename) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // відкриваємо BI‑фрейм
  await page.goto(url, { waitUntil: 'networkidle' });

  // чекаємо кнопку "Export"
  await page.waitForSelector('button:has-text("Export")');
  await page.click('button:has-text("Export")');

  // клікаємо саме "Formatted Excel"
  await page.click('button:has-text("Formatted Excel")');

  // чекаємо завантаження файлу
  const download = await page.waitForEvent('download');
  await download.saveAs(filename);

  await browser.close();
  console.log(`Файл збережено як ${filename}`);

  // === Парсинг Excel у JSON ===
  const workbook = XLSX.readFile(filename);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(sheet, { raw: false });

  // Тепер jsonData містить масив об’єктів, включно з гіперпосиланнями
  return jsonData;
}

function parseExcelWithLinks(filename) {
  const workbook = XLSX.readFile(filename);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const jsonData = XLSX.utils.sheet_to_json(sheet, { raw: false });

  // Додаємо гіперпосилання з клітинок
  jsonData.forEach((row, rowIndex) => {
    for (const col in sheet) {
      if (col[0] === '!') continue; // службові поля
      const cell = sheet[col];
      if (cell && cell.l && cell.l.Target) {
        // cell.l.Target містить URL гіперпосилання
        const header = col.replace(/[0-9]/g, ''); // визначаємо колонку
        if (!row[`${header}_link`]) {
          row[`${header}_link`] = cell.l.Target;
        }
      }
    }
  });

  return jsonData;
}

// === Deduplicator ===
async function deduplicate(newData, collection) {
  const existingIds = await collection.distinct("ID");
  return newData.filter(item => !existingIds.includes(item.ID));
}

// === Enricher ===
const cheerio = require('cheerio');

// Витягування контактної особи та телефону
async function fetchContactInfo(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // ПІБ контактної особи
    const name = $('.contact-point__subject').first().text().trim();

    // Телефон
    const phone = $('a[href^="tel:"] .link-blank__text').first().text().trim();

    // Email
    const email = $('a[href^="mailto:"]')
      .first()
      .attr('href')
      ?.replace('mailto:', '')
      .trim();

    return { contractor: name || null, pone: phone || null, email: email || null };
  } catch (err) {
    console.error(`Помилка при запиті ${url}:`, err.message);
    return { contractor: null, pone: null, email: null };
  }
}


// Витягування даних по лоту
async function fetchLotInfo(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const lotName = $('h2.title.title--large').first().text().trim();
    let lotDescription = $('div.lot-description').first().text().trim();
    if (!lotDescription) {
      lotDescription = $('div.text-block').first().text().trim();
    }

    return { lotName: lotName || null, lotDescription: lotDescription || null };
  } catch (err) {
    console.error(`Помилка при запиті ${url}:`, err.message);
    return { lotName: null, lotDescription: null };
  }
}

// Основна enrich
async function enrich(data) {
  const enrichedData = [];

  for (const item of data) {
    let contractor = null;
    let pone = null;
    let email = null;
    let lotName = null;
    let lotDescription = null;

    // Організатор
    if (item['Організатор_link']) {
      const contactInfo = await fetchContactInfo(item['Організатор_link']);
      contractor = contactInfo.contractor;
      pone = contactInfo.pone;
      email = contactInfo.email;
    }

    // Лот
    if (item['Лот_link']) {
      const lotInfo = await fetchLotInfo(item['Лот_link']);
      lotName = lotInfo.lotName;
      lotDescription = lotInfo.lotDescription;
    }

    enrichedData.push({
      ...item,
      contractor,
      pone,
      email,
      lotName,
      lotDescription
    });
  }

  return enrichedData;
}


// === Sync to MongoDB ===
const { MongoClient } = require('mongodb');

async function syncToMongo(data, collectionName) {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db("prozorro");
    const collection = db.collection(collectionName);

    // Вставляємо або оновлюємо дані по ID тендера
    for (const item of data) {
      await collection.updateOne(
        { ID: item.ID },   // шукаємо по ID
        { $set: item },    // оновлюємо всі поля
        { upsert: true }   // якщо нема — створюємо новий документ
      );
    }

    console.log(`Синхронізовано ${data.length} записів у колекцію ${collectionName}`);
  } catch (err) {
    console.error("Помилка при синхронізації:", err.message);
  } finally {
    await client.close();
  }
}

// === Main ===
async function main() {
  const urls = {
    forecast: "https://bi.prozorro.org/single/?appid=7fa5749b-3186-48c2-80bf-4e9e49f1d71a&obj=yXDpjY&theme=sense&opt=ctxmenu,currsel&select=AltSelState::_Language,EN&select=$::_Language,UA&select=$::%D0%9A%D0%BB%D0%B0%D1%81%20CPV,33690000-3%20%D0%9B%D1%96%D0%BA%D0%B0%D1%80%D1%81%D1%8C%D0%BA%D1%96%20%D0%B7%D0%B0%D1%81%D0%BE%D0%B1%D0%B8%20%D1%80%D1%96%D0%B7%D0%BD%D1%96,38430000-8%20%D0%94%D0%B5%D1%82%D0%B5%D0%BA%D1%82%D0%BE%D1%80%D0%B8%20%D1%82%D0%B0%20%D0%B0%D0%BD%D0%B0%D0%BB%D1%96%D0%B7%D0%B0%D1%82%D0%BE%D1%80%D0%B8&select=AltSelState::_DimPlansNo,0" ,
    contracts: "https://bi.prozorro.org/single/?appid=fba3f2f2-cf55-40a0-a79f-b74f5ce947c2&obj=VcLPJX&theme=sense&opt=ctxmenu,currsel&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CompExpressionNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CompDimensionNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_KPIShowType,abs&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_KPIShow,0&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_CTPK,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_DimPrevDaysNo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_DBKPINo,1&select=%D0%92%D1%96%D0%B4%D0%B1%D0%BE%D1%80%D0%B8%20%D0%B4%D0%BE%20%D0%BF%D0%BE%D1%80%D1%96%D0%B2%D0%BD%D1%8F%D0%BD%D0%BD%D1%8F::_Language,UA&select=AltSelState::_CompExpressionNo,1&select=AltSelState::_CompDimensionNo,1&select=AltSelState::_KPIShowType,%25&select=AltSelState::_KPIShow,1&select=AltSelState::_CTPK,1&select=AltSelState::_DimPrevDaysNo,1&select=AltSelState::_DBKPINo,1&select=AltSelState::_Language,EN&select=$::_CompExpressionNo,1&select=$::_CompDimensionNo,1&select=$::_KPIShowType,abs&select=$::_KPIShow,0&select=$::_CTPK,1&select=$::_DimPrevDaysNo,1&select=$::_DBKPINo,1&select=$::_Language,UA&select=$::%D0%9A%D0%BB%D0%B0%D1%81%20CPV%20%D0%BB%D0%BE%D1%82%D0%B0%20(%D0%B0%D0%B3%D1%80%D0%B5%D0%B3%D0%BE%D0%B2%D0%B0%D0%BD%D0%BE),33690000-3%20%D0%9B%D1%96%D0%BA%D0%B0%D1%80%D1%81%D1%8C%D0%BA%D1%96%20%D0%B7%D0%B0%D1%81%D0%BE%D0%B1%D0%B8%20%D1%80%D1%96%D0%B7%D0%BD%D1%96,38430000-8%20%D0%94%D0%B5%D1%82%D0%B5%D0%BA%D1%82%D0%BE%D1%80%D0%B8%20%D1%82%D0%B0%20%D0%B0%D0%BD%D0%B0%D0%BB%D1%96%D0%B7%D0%B0%D1%82%D0%BE%D1%80%D0%B8&select=AltSelState::_DimTenderersNo,0&select=AltSelState::_DimTendersNo,0"  };

for (const [name, url] of Object.entries(urls)) {
  const filename = `${name}.xlsx`;
  await downloadProzorroBI(url, filename);

  const newData = parseExcelWithLinks(filename);
  const cleanData = await deduplicate(newData, collection);
  const enrichedData = await enrich(cleanData);

  await syncToMongo(enrichedData, `labs_${name}`);
}

    // TODO: розпарсити Excel у JSON (через xlsx або exceljs)
    for (const [name, url] of Object.entries(urls)) {
  const filename = `${name}.xlsx`;
  await downloadProzorroBI(url, filename);

  // тепер парсимо Excel у JSON з гіперпосиланнями
  const newData = parseExcelWithLinks(filename);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db("prozorro");
  const collection = db.collection(`labs_${name}`);

  const cleanData = await deduplicate(newData, collection);
  const enrichedData = enrich(cleanData);
  await syncToMongo(enrichedData, `labs_${name}`);

  await client.close();
}


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
module.exports = { main };
