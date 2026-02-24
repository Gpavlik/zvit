const { google } = require("googleapis");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const cheerio = require("cheerio");
const fs = require("fs");
const axios = require("axios");
const mongoose = require("mongoose");
const Lab = mongoose.model("Lab");


const MONGO_URI = process.env.MONGO_URI;
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

// === Downloader з Google Drive ===
async function downloadFromDrive(fileId, filename) {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  fs.writeFileSync(filename, Buffer.from(res.data));
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
      if (col[0] === "!") continue;
      const cell = sheet[col];
      if (cell && cell.l && cell.l.Target) {
        const header = col.replace(/[0-9]/g, "");
        row[`${header}_link`] = cell.l.Target;
      }
    }
  });

  return jsonData;
}

// === Helpers ===
function extractEdrpou(organizerField) {
  if (!organizerField) return null;
  const parts = organizerField.split("|");
  return parts.length > 1 ? parts[1].trim() : null;
}

// === Fetch details from Prozorro ===
async function fetchDetails(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const contractor = $(".contact-point__subject").first().text().trim();
    const phone = $('a[href^="tel:"] .link-blank__text').first().text().trim();
    const email = $('a[href^="mailto:"]').first().attr("href")?.replace("mailto:", "").trim();

    return { contractor, phone, email };
  } catch {
    return { contractor: null, phone: null, email: null };
  }
}

// === Enricher ===
async function enrich(data, type) {
  const enrichedData = [];
  for (const item of data) {
    const edrpou = extractEdrpou(item["Організатор"]);
    let contractor = null, phone = null, email = null;

    if (type === "contracts" && item["Ідентифікатор договору_link"]) {
      const contractInfo = await fetchDetails(item["Ідентифікатор договору_link"]);
      contractor = contractInfo.contractor;
      phone = contractInfo.phone;
      email = contractInfo.email;
    }

    if (type === "forecast" && item["Ідентифікатор пункту плану_link"]) {
      const planInfo = await fetchDetails(item["Ідентифікатор пункту плану_link"]);
      contractor = planInfo.contractor;
      phone = planInfo.phone;
      email = planInfo.email;
    }

    enrichedData.push({ ...item, edrpou, contractor, phone, email, type });
  }
  return enrichedData;
}

// === Sync to MongoDB (оновлюємо labs) ===
async function syncToMongo(data) {
  await mongoose.connect(MONGO_URI);

  for (const item of data) {
    const edrpou = item.edrpou;
    if (!edrpou) continue;

    let tenderEntry = null;

    if (item.type === "contracts") {
      tenderEntry = {
        title: item["Заголовки лотів договору"] || "Невідомий тендер",
        amount: item["Поточна сума договорів"] ? Number(item["Поточна сума договорів"]) : null,
        currency: "UAH",
        status: "active",
        deadline: item["Дата публікації договору"] ? new Date(item["Дата публікації договору"]) : null,
        winner: item["Постачальник"] || null
      };
    }

    if (item.type === "forecast") {
      tenderEntry = {
        title: item["Пункт плану (розширений)"] || "Плановий тендер",
        amount: item["Сума пунктів плану"] ? Number(item["Сума пунктів плану"]) : null,
        currency: "UAH",
        status: "planned",
        deadline: item["Рік-Місяць планованого оголошення"] ? new Date(item["Рік-Місяць планованого оголошення"]) : null,
        winner: null
      };
    }

    if (tenderEntry) {
      await Lab.updateOne(
        { edrpou },
        {
          $set: {
            contractor: item.contractor,
            phone: item.phone,
            email: item.email,
            updatedAt: new Date()
          },
          $push: { tenders: tenderEntry }
        },
        { upsert: true }
      );
      console.log(`Оновлено: ${edrpou} (${item.contractor || "невідомий"})`);
    }
  }

  console.log(`Синхронізовано ${data.length} записів у labs`);
  await mongoose.disconnect();
}

// === Main ===
async function main() {
  const fileIds = {
    forecast: "1EwnFUdMe4CLE73VT3s9xO187a8ezyXQm",
    contracts: "1bYGwPBrXm_merxSbewHZgl7bCSAB8fxh"
  };

  for (const [name, fileId] of Object.entries(fileIds)) {
    const filename = `${name}.xlsx`;
    await downloadFromDrive(fileId, filename);

    const newData = parseExcelWithLinks(filename);
    const enrichedData = await enrich(newData, name);

    await syncToMongo(enrichedData);
  }
}

module.exports = { main };
