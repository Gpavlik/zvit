const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "labCards.json");

app.use(express.json());

// Завантажити всі лабораторії
app.get("/labcards", (req, res) => {
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Не вдалося прочитати файл" });
    res.json(JSON.parse(data || "[]"));
  });
});

// Додати або оновити лабораторію
app.post("/labcards", (req, res) => {
  const newLab = req.body;
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    let labs = [];
    if (!err && data) labs = JSON.parse(data);
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
    if (!err && data) labs = JSON.parse(data);
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
