const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// 🟢 Реєстрація користувача (з хешуванням пароля)
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
app.post("/login", async (req, res) => { const { login, password } = req.body; try { const user = await User.findOne({ login }); if (!user) return res.status(401).json({ error: "❌ Невірний логін або пароль" }); const match = await bcrypt.compare(password, user.password); if (!match) return res.status(401).json({ error: "❌ Невірний логін або пароль" }); res.json({ message: "✅ Авторизація успішна", role: user.role, territory: user.territory || null, district: user.district || null, districts: user.districts || [] }); } catch (err) { res.status(500).json({ error: "❌ Помилка сервера" }); } });

// 🟢 Вихід
app.post("/logout", (req, res) => {
  res.json({ message: "🚪 Ви успішно вийшли з системи" });
});

// 🟢 Отримати всі лабораторії
app.get("/labcards", async (req, res) => {
  try {
    const labs = await Lab.find();
    res.json(labs);
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося отримати лабораторії" });
  }
});

// 🟢 Додати/оновити лабораторію
app.post("/labcards", async (req, res) => {
  try {
    const lab = req.body;
    let existing = await Lab.findOne({ _id: lab._id });
    if (existing) {
      await Lab.updateOne({ _id: lab._id }, lab);
      res.json({ message: "✅ Оновлено", lab });
    } else {
      const newLab = new Lab(lab);
      await newLab.save();
      res.json({ message: "✅ Додано", lab: newLab });
    }
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося зберегти лабораторію" });
  }
});

// 🟢 Видалити лабораторію
app.delete("/labcards/:id", async (req, res) => {
  try {
    await Lab.findByIdAndDelete(req.params.id);
    res.json({ message: `🗑️ Лабораторія ${req.params.id} видалена` });
  } catch (err) {
    res.status(500).json({ error: "❌ Не вдалося видалити лабораторію" });
  }
});

// 🟢 Лабораторії для конкретного користувача
app.get("/labcards/user/:login", async (req, res) => {
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
