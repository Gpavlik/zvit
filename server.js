const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // ✅ Дозволяє запити з будь-якого фронтенду
app.use(express.json());

const DATA_FILE = path.join(__dirname, "labCards.json");

app.use(express.json());

// Кореневий маршрут
app.get("/", (req, res) => {
  res.send("✅ API працює. Використовуйте /labcards");
});

// Завантажити всі лабораторії
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

app.listen(PORT, () => {
  console.log(`✅ Сервер запущено на порті ${PORT}`);
});
