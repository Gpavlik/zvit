const mongoose = require("mongoose");
const fetch = require("node-fetch");

const uri = process.env.MONGO_URI;       // Atlas URI
const apiKey = process.env.OPENCAGE_KEY; // OpenCage API key

mongoose.connect(uri);

const EnterpriseSchema = new mongoose.Schema({}, { strict: false });
const Enterprise = mongoose.model("Enterprise", EnterpriseSchema);

async function geocode(query) {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(query)}&key=${apiKey}&language=uk&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results && data.results.length > 0) {
    const result = data.results[0];
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
  let updatedCount = 0;

  for (const doc of docs) {
    const name = doc.partner || doc.institution || "Невідомо";
    const edrpou = doc.edrpou || "";
    const city = doc.city || "";
    const region = doc.region || "";

    // Формуємо запит
    let query = doc.address && doc.address.trim() !== ""
      ? doc.address
      : `${name} ${edrpou} ${city} ${region}`;

    console.log(`🔍 Запит: ${query}`);

    const geo = await geocode(query);
    if (!geo) {
      console.log(`❌ Не знайдено для: ${query}`);
      continue;
    }

    // Переписуємо завжди
    doc.lat = geo.lat;
    doc.lng = geo.lng;
    doc.address = geo.address;

    await doc.save();
    updatedCount++;

    console.log(`✅ Оновлено: ${name} (${edrpou}) → ${geo.address} [${geo.lat}, ${geo.lng}]`);
  }

  console.log(`🏁 Завершено. Оновлено документів: ${updatedCount}`);
  process.exit(0);
}

fixCoords().catch(err => {
  console.error("Помилка:", err);
  process.exit(1);
});
