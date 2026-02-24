// ==========================
// Імпорти
// ==========================
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");
const { main } = require("./bi_sync");
const Lab = require("./models/Lab");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "supersecretkey";
require("dotenv").config();
const SECRET = process.env.JWT_SECRET || "supersecretkey";

// ==========================
// Middleware
// ==========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ==========================
// Підключення до MongoDB Atlas
// ==========================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Підключено до MongoDB Atlas"))
  .catch(err => console.error("❌ Помилка MongoDB:", err));

// ==========================
// Схеми
// ==========================
const UserSchema = new mongoose.Schema({
  login: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: String,
  district: String,
  territory: String,
  districts: [String]
});


const VisitSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // UUID або ObjectId як рядок
  edrpou: { type: String, index: true },
  date: { type: Date, required: true },
  status: {
    type: String,
    enum: ["planned", "started", "finished", "cancelled", "rescheduled"],
    default: "planned"
  },
  manager: { type: String, required: true },
  notes: String,
  rescheduledDate: Date,
  orders: [{
    type: { type: String, enum: ["reagent", "device"] },
    name: String,
    quantity: Number
  }]
}, { timestamps: true });

// ==========================
// Моделі
// ==========================
const User = mongoose.model("User", UserSchema);

const Visit = mongoose.model("Visit", VisitSchema);

// ==========================
// Реєстрація / Логін
// ==========================
app.post("/register", async (req, res) => {
  try {
    const { login, password, role, district, territory, districts } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ login, password: hashedPassword, role, district, territory, districts });
    await newUser.save();
    res.json({ message: "✅ Користувач створений" });
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при створенні користувача" });
  }
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const user = await User.findOne({ login });
    if (!user) return res.status(401).json({ error: "❌ Невірний логін або пароль" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "❌ Невірний логін або пароль" });
    const token = jwt.sign({ login: user.login, role: user.role }, SECRET, { expiresIn: "1d" });
    res.json({ message: "✅ Авторизація успішна", role: user.role, token });
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка сервера" });
  }
});

// ==========================
// Middleware для токена
// ==========================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(403).json({ error: "❌ Немає токена" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: "❌ Невірний токен" });
  }
}

// ==========================
// Лабораторії
// ==========================
app.get("/labs", authMiddleware, async (req, res) => {
  try {
    const labs = await Lab.find();
    res.json(labs);
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося отримати лабораторії" });
  }
});

app.post("/labs/update", authMiddleware, async (req, res) => {
  try {
    const labs = req.body;
    for (const lab of labs) {
      let filter = {};
      if (lab.edrpou && lab.edrpou !== "ФОП") {
        filter = { edrpou: lab.edrpou };
      } else if (lab._id) {
        filter = { _id: lab._id };
      } else {
        continue;
      }

      const { _id, ...labData } = lab; // не оновлюємо _id

      await Lab.updateOne(
        filter,
        { $set: { ...labData, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ success: true, count: labs.length });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося оновити лабораторії" });
  }
});

// Очистка колекції labs
app.delete("/labs/clear", authMiddleware, async (req, res) => {
  try {
    await Lab.deleteMany({});
    res.json({ success: true, message: "✅ Колекцію labs очищено" });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося очистити labs" });
  }
});

// Масове перенесення з IndexedDB
app.post("/labs/migrate", authMiddleware, async (req, res) => {
  try {
    const labs = req.body;
    if (!Array.isArray(labs)) {
      return res.status(400).json({ error: "❌ Очікується масив лабораторій" });
    }

    for (const lab of labs) {
      let filter = {};
      if (lab.edrpou && lab.edrpou !== "ФОП") {
        filter = { edrpou: lab.edrpou };
      } else if (lab._id) {
        filter = { _id: lab._id };
      } else {
        continue;
      }

      const { _id, ...labData } = lab; // не оновлюємо _id

      await Lab.updateOne(
        filter,
        { $set: { ...labData, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    res.json({ success: true, count: labs.length });
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при міграції", details: err.message });
  }
});

// ==========================
// Візити
// ==========================
app.get("/visits", authMiddleware, async (req, res) => {
  try {
    const visits = await Visit.find();
    res.json(visits);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при отриманні візитів" });
  }
});

app.post("/visits/update", authMiddleware, async (req, res) => {
  try {
    const visits = req.body;
    for (const visit of visits) {
      let filter = {};
      if (visit.edrpou && visit.edrpou !== "ФОП") {
        filter = { edrpou: visit.edrpou, date: visit.date };
      } else if (visit._id) {
        filter = { _id: visit._id };
      } else {
        continue;
      }

      const { _id, ...visitData } = visit; // не оновлюємо _id

      await Visit.updateOne(
        filter,
        { $set: { ...visitData, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ success: true, count: visits.length });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося оновити візити" });
  }
});

// ==========================
// Health check
// ==========================
app.get("/", (req, res) => res.send("API працює ✅"));

// ==========================
// Оновлення БД вручну
// ==========================
app.get("/sync", async (req, res) => {
  try {
    await main();
    res.send("Цикл оновлення виконано успішно!");
  } catch (err) {
    console.error("Помилка циклу:", err);
    res.status(500).send("Помилка при виконанні циклу");
  }
});

// Автоматичний запуск щоп’ятниці о 23:00
cron.schedule("0 23 * * 5", () => {
  console.log("Запускаю цикл оновлення (п’ятниця 23:00)...");
  main().catch(err => console.error("Помилка циклу:", err));
});

// ==========================
// Запуск сервера
// ==========================
app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
// ==========================
// Синхронізація тендерів у labs
// ==========================
app.get("/labs/tenders/sync", authMiddleware, async (req, res) => {
  try {
    await main(); // запускає BI sync
    res.json({ success: true, message: "✅ Масова синхронізація тендерів виконана" });
  } catch (err) {
    console.error("❌ Помилка масової синхронізації:", err);
    res.status(500).json({ error: "❌ Не вдалося виконати масову синхронізацію" });
  }
});
