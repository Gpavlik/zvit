const { google } = require("googleapis");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const cheerio = require("cheerio");
const fs = require("fs");
const axios = require("axios");
const Lab = require("./models/Lab");

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
  return await Promise.all(data.map(async item => {
    const edrpou = extractEdrpou(item["Організатор"]);
    let contractor = null, phone = null, email = null;

    try {
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
    } catch (err) {
      console.error("❌ Помилка Prozorro:", err.message);
    }

    return { ...item, edrpou, contractor, phone, email, type };
  }));
}


// === Sync to MongoDB (оновлюємо labs) ===
async function syncToMongo(data) {
  const operations = data.map(item => {
    const edrpou = item.edrpou;
    if (!edrpou) return null;

    let tenderEntry = null;

    if (item.type === "contracts") {
      const amountRaw = item["Поточна сума договорів"];
      const deadlineRaw = item["Дата публікації договору"];
      const winnerRaw = item["Постачальник"];

      tenderEntry = {
        title: item["Заголовки лотів договору"] || "Невідомий тендер",
        amount: amountRaw && !isNaN(Number(amountRaw)) ? Number(amountRaw) : null,
        currency: "UAH",
        status: "active",
        deadline: deadlineRaw && !isNaN(Date.parse(deadlineRaw)) ? new Date(deadlineRaw) : null,
        winner: winnerRaw ? winnerRaw.split("|")[0].trim() : null
      };
    }

    if (item.type === "forecast") {
      const amountRaw = item["Сума пунктів плану"];
      const deadlineRaw = item["Рік-Місяць планованого оголошення"];

      tenderEntry = {
        title: item["Пункт плану (розширений)"] || "Плановий тендер",
        amount: amountRaw && !isNaN(Number(amountRaw)) ? Number(amountRaw) : null,
        currency: "UAH",
        status: "planned",
        deadline: deadlineRaw && !isNaN(Date.parse(deadlineRaw)) ? new Date(deadlineRaw) : null,
        winner: null
      };
    }

    if (!tenderEntry) return null;

    return {
      updateOne: {
        filter: { edrpou },
        update: {
          $set: {
            contractor: item.contractor,
            phone: item.phone,
            email: item.email,
            updatedAt: new Date()
          },
          $push: { tenders: tenderEntry }
        },
        upsert: true
      }
    };
  }).filter(op => op !== null);

  if (operations.length > 0) {
    await Lab.bulkWrite(operations);
    console.log(`Синхронізовано ${operations.length} записів у labs`);
  }
}

// === Main ===
async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Підключено до MongoDB Atlas");

    const fileIds = {
      forecast: "1EwnFUdMe4CLE73VT3s9xO187a8ezyXQm",
      contracts: "1bYGwPBrXm_merxSbewHZgl7bCSAB8fxh"
    };

    for (const [name, fileId] of Object.entries(fileIds)) {
      const filename = `${name}.xlsx`;
      await downloadFromDrive(fileId, filename);

      const newData = parseExcelWithLinks(filename);
      console.log(`📊 Файл ${name}: ${newData.length} рядків`);

      const BATCH_SIZE = 10000;
      for (let i = 0; i < newData.length; i += BATCH_SIZE) {
        const batch = newData.slice(i, i + BATCH_SIZE);
        console.log(`🚀 Обробляю батч ${i / BATCH_SIZE + 1} (${batch.length} рядків)`);

        const enrichedData = await enrich(batch, name);
        await syncToMongo(enrichedData);

        console.log(`✅ Завершено батч ${i / BATCH_SIZE + 1}`);
      }
    }

    await mongoose.disconnect();
    console.log("🎉 Всі файли оброблено!");
  } catch (err) {
    console.error("❌ Помилка масової синхронізації:", err);
  }
}

// === Правильний експорт ===
module.exports = { main };
