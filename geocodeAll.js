const mongoose = require("mongoose");
const fetch = global.fetch; // у Node.js 18+ fetch вже є глобально

// 🔗 Підключення до MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Підключено до MongoDB"))
  .catch(err => console.error("❌ Помилка MongoDB:", err));

const LabSchema = new mongoose.Schema({
  partner: String,
  region: String,
  city: String,
  institution: String,
  address: String,
  edrpou: String,
  lat: Number,
  lng: Number
});

const Lab = mongoose.model("Lab", LabSchema);

// 🟢 Функція геокодування
async function geocodeLab(lab) {
  if (!lab.city && !lab.institution && !lab.address) {
    console.log(`⚠️ Пропущено (немає адреси): ${lab.partner}`);
    return lab;
  }

  const query = `${lab.region || ""} ${lab.city || ""} ${lab.address || lab.institution || ""}`;
  try {
    const res = await fetch(
      `https://api.openrouteservice.org/geocode/search?api_key=${process.env.ORS_TOKEN}&text=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    const coords = data.features[0]?.geometry?.coordinates;

    if (coords) {
      lab.lng = coords[0];
      lab.lat = coords[1];
      await lab.save();
      console.log(`✅ Оновлено координати для: ${lab.partner} (${lab.city})`);
    } else {
      console.log(`❌ Не знайдено координати: ${lab.partner} (${query})`);
    }
  } catch (err) {
    console.error(`❌ Помилка геокодування для ${lab.partner}:`, err.message);
  }
  return lab;
}

// 🟢 Масове оновлення
async function updateAllLabs() {
  const labs = await Lab.find();
  console.log(`🔍 Знайдено ${labs.length} лабораторій`);

  for (const lab of labs) {
    await geocodeLab(lab);
    await new Promise(r => setTimeout(r, 500)); // невелика пауза, щоб не перевищити ліміт ORS
  }

  console.log("🎉 Масове оновлення завершено");
  mongoose.disconnect();
}

updateAllLabs();
