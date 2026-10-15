import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const ORIGIN = process.env.FRONTEND_URL || "*";
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });
app.use(cors({ origin: ORIGIN }));
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

// ---------- Multiplayer ----------
const COLORS = ["#c0392b", "#2980b9", "#8e44ad", "#16a085", "#d35400", "#7f8c8d"];
const players = {};
const STATES = ["walk", "wait", "bite", "reel"];
const num = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));

io.on("connection", (socket) => {
  socket.on("join", ({ name } = {}) => {
    players[socket.id] = {
      id: socket.id,
      name: String(name || "Pescador").slice(0, 14),
      color: COLORS[Object.keys(players).length % COLORS.length],
      x: 240, dir: 1, state: "walk", bx: 270,
    };
    socket.emit("players", Object.values(players));
    socket.broadcast.emit("player:join", players[socket.id]);
  });

  socket.on("move", (d = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = num(d.x, 0, 480);
    p.dir = d.dir === -1 ? -1 : 1;
    p.state = STATES.includes(d.state) ? d.state : "walk";
    p.bx = num(d.bx, 0, 480);
    socket.volatile.broadcast.emit("player:move", { id: p.id, x: p.x, dir: p.dir, state: p.state, bx: p.bx });
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit("player:leave", socket.id);
    }
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Servidor rodando"));
