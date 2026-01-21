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
  origin: ["http://127.0.0.1:5500"], // для локальної розробки
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(bodyParser.json());
app.use(express.json());

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
});

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
  }],
  createdAt: { type: Date, default: Date.now }
});

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

app.get("/labs/:edrpou", authMiddleware, async (req, res) => {
  try {
    const lab = await Lab.findOne({ edrpou: req.params.edrpou });
    if (!lab) return res.status(404).json({ error: "Лабораторія не знайдена" });
    res.json(lab);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка сервера" });
  }
});

app.post("/labs/new", authMiddleware, async (req, res) => {
  try {
    const { partner, city, institution, edrpou } = req.body;
    const newLab = new Lab({ partner, city, institution, edrpou });
    await newLab.save();
    res.json({ message: "✅ Лабораторію створено", lab: newLab });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося створити лабораторію" });
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

app.post("/visits", authMiddleware, async (req, res) => {
  try {
    const { labId, date, manager, notes } = req.body;
    const visit = new Visit({ labId, date, manager, notes, status: "planned" });
    await visit.save();
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при створенні візиту" });
  }
});

app.patch("/visits/:id/start", authMiddleware, async (req, res) => {
  try {
    const visit = await Visit.findByIdAndUpdate(req.params.id, { status: "started" }, { new: true });
    if (!visit) return res.status(404).json({ error: "Візит не знайдено" });
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при оновленні візиту" });
  }
});

app.patch("/visits/:id/finish", authMiddleware, async (req, res) => {
  try {
    const visit = await Visit.findByIdAndUpdate(req.params.id, { status: "finished" }, { new: true });
    if (!visit) return res.status(404).json({ error: "Візит не знайдено" });
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при оновленні візиту" });
  }
});

app.patch("/visits/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const visit = await Visit.findByIdAndUpdate(req.params.id, { status: "cancelled" }, { new: true });
    if (!visit) return res.status(404).json({ error: "Візит не знайдено" });
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при оновленні візиту" });
  }
});

app.patch("/visits/:id/reschedule", authMiddleware
