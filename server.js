// ==========================
// Імпорти
// ==========================
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "supersecretkey";

// ==========================
// Middleware
// ==========================
app.use(cors({
  origin: "*", // для локальної розробки
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Використовуємо тільки express.json і express.urlencoded
// Прибираємо bodyParser.json(), щоб не дублювати парсери
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

const LabSchema = new mongoose.Schema({
  partner: String,
  region: String,
  city: String,
  institution: String,
  address: String,
  contractor: String,
  phone: String,
  edrpou: String,
  manager: String,
  lat: Number,
  lng: Number,
  devices: [{
    device: String,
    soldDate: Date,
    lastService: Date,
    kp: String,
    replacedParts: String,
    reagents: [{
      name: String,
      quantity: Number,
      date: Date
    }]
  }],
  tasks: [{
    title: String,
    date: Date,
    tasks: [{
      priority: String,
      action: String,
      device: String
    }]
  }]
}, { timestamps: true }); // додаємо createdAt та updatedAt

const VisitSchema = new mongoose.Schema({
  labId: { type: mongoose.Schema.Types.ObjectId, ref: "Lab", required: true },
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
}, { timestamps: true }); // додаємо createdAt та updatedAt

// ==========================
// Моделі
// ==========================
const User = mongoose.model("User", UserSchema);
const Lab = mongoose.model("Lab", LabSchema);
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

// Отримати зміни після певного часу
app.get("/labs/changes", authMiddleware, async (req, res) => {
  try {
    const since = new Date(parseInt(req.query.since, 10) || 0);
    const labs = await Lab.find({ updatedAt: { $gt: since } });
    res.json(labs);
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося отримати зміни лабораторій" });
  }
});

// Оновити лабораторії (тільки зміни)
app.post("/labs/update", authMiddleware, async (req, res) => {
  try {
    const labs = req.body;
    for (const lab of labs) {
      await Lab.updateOne(
        { _id: lab._id },
        { $set: { ...lab, updatedAt: Date.now() } },
        { upsert: true }
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося оновити лабораторії" });
  }
});

// ==========================
// Візити
// ==========================
app.get("/visits", authMiddleware, async (req, res) => {
  try {
    const visits = await Visit.find().populate("labId");
    res.json(visits);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при отриманні візитів" });
  }
});

// Отримати зміни після певного часу
app.get("/visits/changes", authMiddleware, async (req, res) => {
  try {
    const since = new Date(parseInt(req.query.since, 10) || 0);
    const visits = await Visit.find({ updatedAt: { $gt: since } });
    res.json(visits);
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося отримати зміни візитів" });
  }
});

// Оновити візити (тільки зміни)
app.post("/visits/update", authMiddleware, async (req, res) => {
  try {
    const visits = req.body;
    for (const visit of visits) {
      await Visit.updateOne(
        { _id: visit._id },
        { $set: { ...visit, updatedAt: Date.now() } },
        { upsert: true }
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося оновити візити" });
  }
});

// ==========================
// Health check для Railway
// ==========================
app.get("/", (req, res) => res.send("API працює ✅"));

// ==========================
// Запуск сервера
// ==========================
app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
