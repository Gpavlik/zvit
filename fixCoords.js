const mongoose = require("mongoose");
const fetch = require("node-fetch");

const uri = process.env.MONGO_URI;       // Atlas URI
const apiKey = process.env.OPENCAGE_KEY; // OpenCage API key
const collectionName = process.env.COLLECTION_NAME || "labs"; // назва колекції

mongoose.connect(uri);

const EnterpriseSchema = new mongoose.Schema({}, { strict: false });
const Enterprise = mongoose.model("Enterprise", EnterpriseSchema, collectionName);

async function geocode(query) {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(query)}&key=${apiKey}&language=uk&limit=1&countrycode=ua`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.results && data.results.length > 0) {
    const result = data.results[0];
    // перевірка країни
    if (result.components.country_code !== "ua") {
      console.warn("❌ Результат не з України:", result.formatted);
      return null;
    }
    return {
      lat: result.geometry.lat,
      lng: result.geometry.lng,
      address: result.formatted
    };
  }
  return null;
}

async function fixCoords() {
  const docs = await Enterprise.find({});
  console.log(`Знайдено документів: ${docs.length}`);
  let updatedCount = 0;
  const notFound = [];

  for (const doc of docs) {
    const name = doc.institution || doc.partner || "Невідомо";
    const city = doc.city || "";
    const region = doc.region || "";

    // формуємо простий запит без зайвих деталей
    const query = `${name}, ${city}, ${region}, Україна`;

    console.log(`🔍 Запит: ${query}`);

    const geo = await geocode(query);
    if (!geo) {
      console.log(`❌ Не знайдено для: ${query}`);
      notFound.push({ edrpou: doc.edrpou, name, city, region });
      continue;
    }

    // Переписуємо завжди
    doc.lat = geo.lat;
    doc.lng = geo.lng;
    doc.address = geo.address;

    await doc.save();
    updatedCount++;

    console.log(`✅ Оновлено: ${name} (${doc.edrpou || ""}) → ${geo.address} [${geo.lat}, ${geo.lng}]`);
  }

  console.log(`🏁 Завершено. Оновлено документів: ${updatedCount}`);
  if (notFound.length > 0) {
    console.log("📋 Не знайдено для наступних ЛПЗ:");
    notFound.forEach(l => {
      console.log(`   ${l.name} (${l.edrpou || ""}) — ${l.city}, ${l.region}`);
    });
  }
  process.exit(0);
}

fixCoords().catch(err => {
  console.error("Помилка:", err);
  process.exit(1);
});
