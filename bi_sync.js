const axios = require("axios");
const { MongoClient } = require("mongodb");
const { chromium } = require("playwright");
const XLSX = require("xlsx");
const cheerio = require("cheerio");

// Mongo URI беремо з Railway secrets
const MONGO_URI = process.env.MONGO_URI;

// === Downloader ===
async function downloadProzorroBI(url, filename) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Export")');
  await page.click('button:has-text("Export")');
  await page.click('button:has-text("Formatted Excel")');

  const download = await page.waitForEvent('download');
  await download.saveAs(filename);

  await browser.close();
  console.log(`Файл збережено як ${filename}`);

  return XLSX.readFile(filename);
}

// === Parser with links ===
function parseExcelWithLinks(filename) {
  const workbook = XLSX.readFile(filename);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(sheet, { raw: false });

  jsonData.forEach((row) => {
    for (const col in sheet) {
      if (col[0] === '!') continue;
      const cell = sheet[col];
      if (cell && cell.l && cell.l.Target) {
        const header = col.replace(/[0-9]/g, '');
        row[`${header}_link`] = cell.l.Target;
      }
    }
  });

  return jsonData;
}

// === Enricher ===
async function fetchContactInfo(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const name = $('.contact-point__subject').first().text().trim();
    const phone = $('a[href^="tel:"] .link-blank__text').first().text().trim();
    const email = $('a[href^="mailto:"]').first().attr('href')?.replace('mailto:', '').trim();
    return { contractor: name || null, phone: phone || null, email: email || null };
  } catch {
    return { contractor: null, phone: null, email: null };
  }
}

async function fetchLotInfo(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const lotName = $('h2.title.title--large').first().text().trim();
    let auctionDate = $('div:contains("Дата аукціону")').first().text().trim();
    let soldDate = $('div:contains("Дата підписання договору")').first().text().trim();
    return { lotName: lotName || null, auctionDate: auctionDate || null, soldDate: soldDate || null };
  } catch {
    return { lotName: null, auctionDate: null, soldDate: null };
  }
}

async function enrich(data) {
  const enrichedData = [];
  for (const item of data) {
    let contractor = null, phone = null, email = null;
    let lotName = null, auctionDate = null, soldDate = null;

    if (item['Організатор_link']) {
      const contactInfo = await fetchContactInfo(item['Організатор_link']);
      contractor = contactInfo.contractor;
      phone = contactInfo.phone;
      email = contactInfo.email;
    }
    if (item['Лот_link']) {
      const lotInfo = await fetchLotInfo(item['Лот_link']);
      lotName = lotInfo.lotName;
      auctionDate = lotInfo.auctionDate;
      soldDate = lotInfo.soldDate;
    }
    enrichedData.push({ ...item, contractor, phone, email, lotName, auctionDate, soldDate });
  }
  return enrichedData;
}

// === Sync to MongoDB ===
async function syncToMongo(data, collectionName) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db("prozorro");
    const collection = db.collection(collectionName);

    for (const item of data) {
      const edrpou = item.ЄДРПОУ || item.edrpou;
      if (!edrpou) continue;

      const lotEntry = {
        lotName: item.lotName,
        auctionDate: item.auctionDate ? new Date(item.auctionDate) : null,
        soldDate: item.soldDate ? new Date(item.soldDate) : null
      };

      await collection.updateOne(
        { edrpou },
        {
          $set: {
            contractor: item.contractor,
            phone: item.phone,
            email: item.email,
            region: item.region,
            city: item.city,
            institution: item.institution,
            address: item.address
          },
          $addToSet: { lots: lotEntry }
        },
        { upsert: true }
      );
    }

    console.log(`Синхронізовано ${data.length} записів у колекцію ${collectionName}`);
  } finally {
    await client.close();
  }
}

// === Main ===
async function main() {
  const urls = {
    forecast: "https://bi.prozorro.org/single/?appid=7fa5749b-3186-48c2-80bf-4e9e49f1d71a&obj=yXDpjY...",
    contracts: "https://bi.prozorro.org/single/?appid=fba3f2f2-cf55-40a0-a79f-b74f5ce947c2&obj=VcLPJX..."
  };

  for (const [name, url] of Object.entries(urls)) {
    const filename = `${name}.xlsx`;
    await downloadProzorroBI(url, filename);

    const newData = parseExcelWithLinks(filename);

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db("prozorro");
    const collection = db.collection(`labs_${name}`);

    const enrichedData = await enrich(newData);
    await syncToMongo(enrichedData, `labs_${name}`);

    await client.close();
  }
}

module.exports = { main };
