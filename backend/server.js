require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Database Setup ───────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, 'gaminghub.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    tokens INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    avatar_url TEXT
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    game TEXT NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0,
    trend TEXT DEFAULT 'stable',
    logo_url TEXT,
    region TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    game TEXT NOT NULL,
    status TEXT DEFAULT 'upcoming',
    prize_pool TEXT,
    entry_fee TEXT,
    token_cost INTEGER,
    start_date DATETIME,
    end_date DATETIME,
    max_teams INTEGER,
    registered_teams INTEGER DEFAULT 0,
    format TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS store_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL,
    token_price INTEGER,
    category TEXT,
    rating REAL,
    image_url TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS token_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    type TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

// ─── Seed Data ────────────────────────────────────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  db.prepare('INSERT INTO users (username, email, tokens, avatar_url) VALUES (?, ?, ?, ?)')
    .run('Kaizen', 'kaizen@example.com', 500, null);

  db.prepare('INSERT INTO teams (name, tag, game, wins, losses, points, tokens, trend, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('Team Alpha', 'ALP', 'Valorant', 15, 5, 1500, 2500, 'up', 'Africa');

  db.prepare('INSERT INTO tournaments (title, game, status, prize_pool, entry_fee, token_cost, start_date, max_teams, registered_teams, format, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('Valorant Championship', 'Valorant', 'live', '$10,000', '$50', 100, '2026-04-22T10:00:00Z', 16, 12, 'bracket', 'https://example.com/tournament.jpg');

  db.prepare('INSERT INTO store_items (name, price, token_price, category, rating, image_url, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('Gaming Mouse', 50, 100, 'gaming-gear', 4.5, 'https://example.com/mouse.jpg', 'High precision gaming mouse');

  db.prepare('INSERT INTO token_history (user_id, amount, type) VALUES (?, ?, ?)').run(1, 100, 'earned');
  db.prepare('INSERT INTO token_history (user_id, amount, type) VALUES (?, ?, ?)').run(1, -50, 'spent');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
// FIX: cors + json middleware must come before routes, not after them
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json());

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  jwt.verify(token, process.env.JWT_SECRET || 'secret-key', (err, user) => {
    if (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ─── File Upload ──────────────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    // FIX: hash the password before storing it
    const hashed = password ? await bcrypt.hash(password, 10) : '';
    const result = db.prepare('INSERT INTO users (username, email, password, tokens) VALUES (?, ?, ?, ?)')
      .run(username, email, hashed, 0);
    const token = jwt.sign({ id: result.lastInsertRowid, email }, process.env.JWT_SECRET || 'secret-key');
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: result.lastInsertRowid.toString(),
          username,
          email,
          tokens: 0,
          joinedAt: new Date().toISOString(),
          avatarUrl: null,
        },
      },
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // FIX: actually verify the password — original code skipped this entirely
  const valid = user.password ? await bcrypt.compare(password, user.password) : true;
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret-key');
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id.toString(),
        username: user.username,
        email: user.email,
        tokens: user.tokens,
        joinedAt: user.joined_at,
        avatarUrl: user.avatar_url,
      },
    },
  });
});

app.post('/api/auth/forgot-password', (req, res) => {
  res.json({ success: true, data: { message: 'Password reset email sent' } });
});

// ─── Profile Routes ───────────────────────────────────────────────────────────
app.get('/api/profile', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({
    success: true,
    data: {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      tokens: user.tokens,
      joinedAt: user.joined_at,
      avatarUrl: user.avatar_url,
    },
  });
});

app.put('/api/profile/update', authenticateToken, (req, res) => {
  const { username } = req.body;
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({
    success: true,
    data: {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      tokens: user.tokens,
      joinedAt: user.joined_at,
      avatarUrl: user.avatar_url,
    },
  });
});

app.post('/api/profile/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
  const avatarUrl = `https://example.com/avatars/${Date.now()}.jpg`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  res.json({ success: true, data: { avatarUrl } });
});

app.get('/api/profile/tokens/history', authenticateToken, (req, res) => {
  const history = db.prepare('SELECT * FROM token_history WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
  res.json({
    success: true,
    data: history.map(h => ({
      id: h.id.toString(),
      amount: h.amount,
      type: h.type,
      date: h.date,
    })),
  });
});

// ─── Teams Routes ─────────────────────────────────────────────────────────────
app.get('/api/teams/rankings', (req, res) => {
  const { game, page = 1, perPage = 20 } = req.query;
  let query = 'SELECT * FROM teams';
  const params = [];
  if (game) {
    query += ' WHERE game = ?';
    params.push(game);
  }
  query += ' ORDER BY points DESC LIMIT ? OFFSET ?';
  params.push(Number(perPage), (page - 1) * perPage);

  const teams = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
  res.json({
    success: true,
    data: teams.map((t, index) => ({
      id: t.id.toString(),
      rank: (page - 1) * Number(perPage) + index + 1,
      name: t.name,
      tag: t.tag,
      game: t.game,
      wins: t.wins,
      losses: t.losses,
      points: t.points,
      tokens: t.tokens,
      trend: t.trend,
      logoUrl: t.logo_url,
      region: t.region,
    })),
    pagination: {
      page: parseInt(page),
      perPage: parseInt(perPage),
      total,
      totalPages: Math.ceil(total / perPage),
    },
  });
});

app.get('/api/teams/my-team', authenticateToken, (req, res) => {
  const team = db.prepare('SELECT * FROM teams LIMIT 1').get();
  if (!team) return res.status(404).json({ success: false, message: 'No team found' });
  res.json({
    success: true,
    data: {
      id: team.id.toString(),
      name: team.name,
      tag: team.tag,
      game: team.game,
      wins: team.wins,
      losses: team.losses,
      points: team.points,
      tokens: team.tokens,
      trend: team.trend,
      logoUrl: team.logo_url,
      region: team.region,
    },
  });
});

app.get('/api/teams/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  res.json({
    success: true,
    data: {
      id: team.id.toString(),
      name: team.name,
      tag: team.tag,
      game: team.game,
      wins: team.wins,
      losses: team.losses,
      points: team.points,
      tokens: team.tokens,
      trend: team.trend,
      logoUrl: team.logo_url,
      region: team.region,
    },
  });
});

app.post('/api/teams', authenticateToken, (req, res) => {
  const { name, tag, game } = req.body;
  const result = db.prepare('INSERT INTO teams (name, tag, game) VALUES (?, ?, ?)').run(name, tag, game);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
  res.json({
    success: true,
    data: {
      id: team.id.toString(),
      name: team.name,
      tag: team.tag,
      game: team.game,
      wins: team.wins,
      losses: team.losses,
      points: team.points,
      tokens: team.tokens,
      trend: team.trend,
      logoUrl: team.logo_url,
      region: team.region,
    },
  });
});

app.post('/api/teams/:id/join', authenticateToken, (req, res) => {
  res.json({ success: true, data: { success: true } });
});

app.delete('/api/teams/:id/leave', authenticateToken, (req, res) => {
  res.json({ success: true, data: { success: true } });
});

app.post('/api/teams/logo', authenticateToken, upload.single('logo'), (req, res) => {
  res.json({ success: true, data: { logoUrl: `https://example.com/logos/${Date.now()}.jpg` } });
});

// ─── Tournaments Routes ───────────────────────────────────────────────────────
app.get('/api/tournaments', (req, res) => {
  const { status, game, page = 1, perPage = 20 } = req.query;
  let query = 'SELECT * FROM tournaments';
  const params = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  if (game) {
    query += (status ? ' AND' : ' WHERE') + ' game = ?';
    params.push(game);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(perPage), (page - 1) * perPage);

  const tournaments = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM tournaments').get().count;
  res.json({
    success: true,
    data: tournaments.map(t => ({
      id: t.id.toString(),
      title: t.title,
      game: t.game,
      status: t.status,
      prizePool: t.prize_pool,
      entryFee: t.entry_fee,
      tokenCost: t.token_cost,
      startDate: t.start_date,
      endDate: t.end_date,
      maxTeams: t.max_teams,
      registeredTeams: t.registered_teams,
      format: t.format,
      imageUrl: t.image_url,
    })),
    pagination: {
      page: parseInt(page),
      perPage: parseInt(perPage),
      total,
      totalPages: Math.ceil(total / perPage),
    },
  });
});

app.get('/api/tournaments/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'Tournament not found' });
  res.json({
    success: true,
    data: {
      id: t.id.toString(),
      title: t.title,
      game: t.game,
      status: t.status,
      prizePool: t.prize_pool,
      entryFee: t.entry_fee,
      tokenCost: t.token_cost,
      startDate: t.start_date,
      endDate: t.end_date,
      maxTeams: t.max_teams,
      registeredTeams: t.registered_teams,
      format: t.format,
      imageUrl: t.image_url,
    },
  });
});

app.post('/api/tournaments/:id/register', authenticateToken, (req, res) => {
  res.json({ success: true, data: { success: true, message: 'Registered successfully' } });
});

app.delete('/api/tournaments/:id/unregister', authenticateToken, (req, res) => {
  res.json({ success: true, data: { success: true } });
});

// ─── Store Routes ─────────────────────────────────────────────────────────────
app.get('/api/store/items', (req, res) => {
  const { category, page = 1, perPage = 20 } = req.query;
  let query = 'SELECT * FROM store_items';
  const params = [];
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(perPage), (page - 1) * perPage);

  const items = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM store_items').get().count;
  res.json({
    success: true,
    data: items.map(i => ({
      id: i.id.toString(),
      name: i.name,
      price: i.price,
      tokenPrice: i.token_price,
      category: i.category,
      rating: i.rating,
      imageUrl: i.image_url,
      description: i.description,
    })),
    pagination: {
      page: parseInt(page),
      perPage: parseInt(perPage),
      total,
      totalPages: Math.ceil(total / perPage),
    },
  });
});

app.get('/api/store/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM store_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  res.json({
    success: true,
    data: {
      id: item.id.toString(),
      name: item.name,
      price: item.price,
      tokenPrice: item.token_price,
      category: item.category,
      rating: item.rating,
      imageUrl: item.image_url,
      description: item.description,
    },
  });
});

app.post('/api/store/checkout', authenticateToken, (req, res) => {
  res.json({ success: true, data: { orderId: 'order_' + Date.now(), message: 'Order placed successfully' } });
});

// ─── Stats Route ──────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const totalUsers        = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const activeTournaments = db.prepare('SELECT COUNT(*) as count FROM tournaments WHERE status = "live"').get().count;
  const registeredTeams   = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
  res.json({
    success: true,
    data: {
      totalUsers,
      activeTournaments,
      totalPrizePool: '$500,000',
      registeredTeams,
    },
  });
});

// ─── Serve React Frontend ─────────────────────────────────────────────────────
// FIX: static serving and catch-all MUST come last, after all API routes.
// FIX: path corrected to ../dist (Vite builds to project root /dist, not backend/dist)
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});