import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// difficulty: 1 (fácil) a 5 (difícil) | rarity: peso do sorteio
const FISH = [
  { id: "piranha-vermelha", name: "Piranha-vermelha", file: "piranha-vermelha.png", difficulty: 3, rarity: 30, points: 40 },
  { id: "budiao-verde",     name: "Budião-verde",     file: "budiao-verde.png",     difficulty: 2, rarity: 45, points: 20 },
  { id: "peixe-voador",     name: "Peixe-voador",     file: "peixe-voador.png",     difficulty: 4, rarity: 18, points: 70 },
  { id: "peixe-bandeira",   name: "Peixe-bandeira",   file: "peixe-bandeira.png",   difficulty: 5, rarity: 7,  points: 120 },
];

const pick = () => {
  let r = Math.random() * FISH.reduce((s, f) => s + f.rarity, 0);
  return FISH.find((f) => (r -= f.rarity) < 0) || FISH[0];
};

app.get("/", (_, res) => res.json({ status: "ok" }));
app.get("/api/fish", (_, res) => res.json(FISH));
app.post("/api/bite", (_, res) => res.json(pick()));
app.post("/api/catch", (req, res) => {
  const fish = FISH.find((f) => f.id === req.body?.id);
  if (!fish) return res.status(400).json({ error: "Peixe inválido" });
  res.json({ ok: true, points: fish.points }); // aqui entra o Supabase depois
});

app.listen(process.env.PORT || 3000, () => console.log("Servidor rodando"));
