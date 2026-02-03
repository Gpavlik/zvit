// fixCoords.js
// Скрипт для переписування координат у MongoDB через OpenCage forward geocoding

const { MongoClient } = require("mongodb");
const fetch = require("node-fetch");

// Використовуємо змінні середовища Railway
const OPENCAGE_KEY = process.env.OPENCAGE_KEY;
const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const collectionName = process.env.COLLECTION_NAME;

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

    const cursor = col.find({});

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      // приклад перевірки: координати поза межами України
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
