const mongoose = require("mongoose");
const fetch = require("node-fetch");

const uri = process.env.MONGO_URI; // твій Atlas URI
const apiKey = process.env.OPENCAGE_KEY; // ключ OpenCage

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

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
      lon: result.geometry.lng,
      address: result.formatted
    };
  }
  return null;
}

async function fixCoords() {
  const docs = await Enterprise.find({});
  let updatedCount = 0;

  for (const doc of docs) {
    const name = doc.name || "Невідомо";
    const edrpou = doc.edrpou || "";
    let query = doc.address ? doc.address : `${name} ${edrpou}`;

    console.log(`🔍 Перевіряю: ${name} (${edrpou})`);

    const geo = await geocode(query);
    if (!geo) {
      console.log(`❌ Не знайдено координат для: ${query}`);
      continue;
    }

    let needUpdate = false;

    if (!doc.lat || !doc.lon || doc.lat !== geo.lat || doc.lon !== geo.lon) {
      doc.lat = geo.lat;
      doc.lon = geo.lon;
      needUpdate = true;
      console.log(`📍 Оновлено координати: ${geo.lat}, ${geo.lon}`);
    }

    if (!doc.address || doc.address !== geo.address) {
      doc.address = geo.address;
      needUpdate = true;
      console.log(`🏢 Оновлено адресу: ${geo.address}`);
    }

    if (needUpdate) {
      await doc.save();
      updatedCount++;
    }
  }

  console.log(`✅ Завершено. Оновлено документів: ${updatedCount}`);
  process.exit(0);
}

fixCoords().catch(err => {
  console.error("Помилка:", err);
  process.exit(1);
});
