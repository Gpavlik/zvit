const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "supersecretkey";

// Middleware
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500"], // дозволені джерела
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(bodyParser.json());
app.use(express.json());

// 🔗 Підключення до MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Підключено до MongoDB Atlas"))
  .catch(err => console.error("❌ Помилка MongoDB:", err));

// 🟢 Схеми
const UserSchema = new mongoose.Schema({
  login: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // зберігаємо хеш
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
  devices: [{
    device: String,
    soldDate: Date,
    lastService: Date,
    kp: String,
    replacedParts: String
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

const User = mongoose.model("User", UserSchema);
const Lab = mongoose.model("Lab", LabSchema);

// 🟢 Реєстрація користувача
app.post("/register", async (req, res) => {
  try {
    const { login, password, role, district, territory, districts } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      login,
      password: hashedPassword,
      role,
      district,
      territory,
      districts
    });

    await newUser.save();
    res.json({ message: "✅ Користувач створений" });
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка при створенні користувача" });
  }
});

// 🟢 Авторизація
app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const user = await User.findOne({ login });
    if (!user) return res.status(401).json({ error: "❌ Невірний логін або пароль" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "❌ Невірний логін або пароль" });

    const token = jwt.sign({ login: user.login, role: user.role }, SECRET, { expiresIn: "1h" });

    res.json({
      message: "✅ Авторизація успішна",
      role: user.role,
      territory: user.territory || null,
      district: user.district || null,
      districts: user.districts || [],
      redirectUrl: "/dashboard",
      token
    });
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка сервера" });
  }
});

// 🟢 Вихід
app.post("/logout", (req, res) => {
  res.json({ message: "🚪 Ви успішно вийшли з системи" });
});

// 🟢 Middleware для перевірки токена
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

// 🟢 Dashboard
app.get("/dashboard", authMiddleware, (req, res) => {
  res.json({
    message: "👋 Ласкаво просимо на головну сторінку!",
    menu: [
      { name: "📅 Календар", url: "/calendar" },
      { name: "🧪 Перелік лабораторій", url: "/labs" },
      { name: "➕ Створити картку лабораторії", url: "/labs/new" }
    ]
  });
});

// 🟢 Календар
app.get("/calendar", authMiddleware, (req, res) => {
  res.json({ events: ["Зустріч 10:00", "Перевірка лабораторії 14:00"] });
});

// 🟢 Перелік лабораторій
app.get("/labs", authMiddleware, async (req, res) => {
  try {
    const labs = await Lab.find();
    res.json(labs);
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося отримати лабораторії" });
  }
});

// 🟢 Створення картки лабораторії
app.post("/labs/new", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const newLab = new Lab({ partner: name });
    await newLab.save();
    res.json({ message: `✅ Лабораторію '${name}' створено`, lab: newLab });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося створити лабораторію" });
  }
});

// 🟢 Лабораторії для конкретного користувача
app.get("/labcards/user/:login", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ login: req.params.login });
    if (!user) return res.status(404).json({ error: "Користувач не знайдений" });

    const labs = await Lab.find();

    if (user.role === "admin") return res.json(labs);
    if (user.role === "employer") return res.json(labs.filter(l => l.district === user.district));
    if (user.role === "territorial_manager") return res.json(labs.filter(l => user.districts.includes(l.district)));

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: "❌ Помилка сервера" });
  }
});

// 🟢 Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
