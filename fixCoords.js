// fixCoords.js
// Скрипт для переписування координат у MongoDB через OpenCage forward geocoding

const { MongoClient } = require("mongodb");
const fetch = require("node-fetch");

// 🔑 Встав свій ключ OpenCage
const OPENCAGE_KEY = "fa2e36a0856f4d958bb51dfdd0f62428";

// 🔗 Параметри MongoDB
const uri = "mongodb://localhost:27017"; // заміни на свій URI
const dbName = "yourDatabase";           // назва бази
const collectionName = "lpz";            // назва колекції

async function geocodeAddress(address) {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(address)}&key=${OPENCAGE_KEY}&language=uk`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.results && data.results.length > 0) {
    const result = data.results[0];
    return {
      lat: result.geometry.lat,
      lon: result.geometry.lng,
      formatted: result.formatted,
      city: result.components.city || result.components.town || result.components.village || "невідомо",
      region: result.components.state || result.components.region || "невідомо"
    };
  } else {
    return null;
  }
}

async function fixCoordinates() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection(collectionName);

    // знайти записи з "поганими" координатами (наприклад, поза Україною)
    const cursor = col.find({});

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      // якщо координати явно некоректні (наприклад, lon > 40 або < 20)
      if (doc.lon < 20 || doc.lon > 40 || doc.lat < 44 || doc.lat > 52) {
        console.log(`Перевіряю: ${doc.name} (${doc.addr})`);

        const geo = await geocodeAddress(doc.addr);
        if (geo) {
          console.log(`→ нові координати: ${geo.lat}, ${geo.lon}`);
          await col.updateOne(
            { _id: doc._id },
            { $set: { lat: geo.lat, lon: geo.lon, addr: geo.formatted, city: geo.city, region: geo.region } }
          );
        } else {
          console.log("→ не вдалося знайти адресу");
        }
      }
    }
  } finally {
    await client.close();
  }
}

fixCoordinates().catch(err => console.error(err));
