const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, "labCards.json");
const USERS_FILE = path.join(__dirname, "users.json");

// Перевірка наявності файлів
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");

// Кореневий маршрут
app.get("/", (req, res) => {
  res.send("✅ API працює. Використовуйте /labcards та /login");
});

// Отримати всі лабораторії
app.get("/labcards", (req, res) => {
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    if (err) return res.json([]);
    try {
      const labs = JSON.parse(data || "[]");
      res.json(Array.isArray(labs) ? labs : []);
    } catch {
      res.json([]);
    }
  });
});

// Додати або оновити лабораторію
app.post("/labcards", (req, res) => {
  const newLab = req.body;
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    let labs = [];
    if (!err && data) {
      try { labs = JSON.parse(data); } catch {}
    }
    const index = labs.findIndex(l => l.id === newLab.id);
    if (index >= 0) labs[index] = newLab;
    else labs.push(newLab);

    fs.writeFile(DATA_FILE, JSON.stringify(labs, null, 2), err => {
      if (err) return res.status(500).json({ error: "Не вдалося зберегти" });
      res.json({ message: "✅ Збережено", lab: newLab });
    });
  });
});

// Видалити лабораторію
app.delete("/labcards/:id", (req, res) => {
  const id = req.params.id;
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    let labs = [];
    if (!err && data) {
      try { labs = JSON.parse(data); } catch {}
    }
    labs = labs.filter(l => l.id !== id);

    fs.writeFile(DATA_FILE, JSON.stringify(labs, null, 2), err => {
      if (err) return res.status(500).json({ error: "Не вдалося видалити" });
      res.json({ message: `🗑️ Лабораторія ${id} видалена` });
    });
  });
});

// Авторизація
app.post("/login", (req, res) => {
  const { login, password } = req.body;
  fs.readFile(USERS_FILE, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Не вдалося прочитати users.json" });

    let users = [];
    try { users = JSON.parse(data || "[]"); } catch {}
    const user = users.find(u => u.login === login && u.password === password);

    if (!user) return res.status(401).json({ error: "❌ Невірний логін або пароль" });

    res.json({
      message: "✅ Авторизація успішна",
      role: user.role,
      territory: user.territory || null,
      district: user.district || null,
      districts: user.districts || []
    });
  });
});

// Отримати лабораторії для конкретного користувача
app.get("/labcards/user/:login", (req, res) => {
  const login = req.params.login;

  fs.readFile(USERS_FILE, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Не вдалося прочитати users.json" });

    let users = [];
    try { users = JSON.parse(data || "[]"); } catch {}
    const user = users.find(u => u.login === login);
    if (!user) return res.status(404).json({ error: "Користувач не знайдений" });

    fs.readFile(DATA_FILE, "utf8", (err, labsData) => {
      let labs = [];
      try { labs = JSON.parse(labsData || "[]"); } catch {}

      if (user.role === "admin") return res.json(labs);
      if (user.role === "employer") return res.json(labs.filter(l => l.district === user.district));
      if (user.role === "territorial_manager") return res.json(labs.filter(l => user.districts.includes(l.district)));

      res.json([]);
    });
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
