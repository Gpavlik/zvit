const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
import cors from "cors"; app.use(cors());

const DATA_FILE = path.join(__dirname, "labCards.json");

// Middleware
app.use(cors());
app.use(express.json());

// Перевірка наявності файлу
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "[]");
  console.log("📂 Створено новий labCards.json");
}

// Кореневий маршрут
app.get("/", (req, res) => {
  res.send("✅ API працює. Використовуйте /labcards");
});

// Отримати всі лабораторії
app.get("/labcards", (req, res) => {
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    if (err) {
      console.warn("⚠️ labCards.json не знайдено або не читається");
      return res.json([]);
    }
    try {
      const labs = JSON.parse(data || "[]");
      res.json(labs);
    } catch (e) {
      console.error("❌ Помилка парсингу JSON:", e);
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
      try {
        labs = JSON.parse(data);
      } catch (e) {
        console.error("❌ Помилка парсингу JSON:", e);
      }
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
      try {
        labs = JSON.parse(data);
      } catch (e) {
        console.error("❌ Помилка парсингу JSON:", e);
      }
    }
    labs = labs.filter(l => l.id !== id);

    fs.writeFile(DATA_FILE, JSON.stringify(labs, null, 2), err => {
      if (err) return res.status(500).json({ error: "Не вдалося видалити" });
      res.json({ message: `🗑️ Лабораторія ${id} видалена` });
    });
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
app.post("/login", (req, res) => {
  const { login, password } = req.body;

  fs.readFile(path.join(__dirname, "users.json"), "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Не вдалося прочитати users.json" });

    const users = JSON.parse(data || "[]");
    const user = users.find(u => u.login === login && u.password === password);

    if (!user) {
      return res.status(401).json({ error: "❌ Невірний логін або пароль" });
    }

    res.json({
      message: "✅ Авторизація успішна",
      role: user.role,
      territory: user.territory || null,
      district: user.district || null,
      districts: user.districts || []
    });
  });
});
app.get("/labcards/:login", (req, res) => {
  const login = req.params.login;

  const users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json"), "utf8"));
  const user = users.find(u => u.login === login);

  if (!user) return res.status(404).json({ error: "Користувач не знайдений" });

  const labs = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (user.role === "admin") {
    return res.json(labs);
  }

  if (user.role === "employer") {
    return res.json(labs.filter(l => l.district === user.district));
  }

  if (user.role === "territorial_manager") {
    return res.json(labs.filter(l => user.districts.includes(l.district)));
  }

  res.json([]);
});
