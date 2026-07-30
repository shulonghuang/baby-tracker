const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== JSON File Data Store ==========

let store = { rooms: {}, users: {}, records: [] };

function loadStore() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!store.rooms) store.rooms = {};
      if (!store.users) store.users = {};
      if (!store.records) store.records = [];
    } catch (e) {
      console.error('Failed to load data file, starting fresh:', e.message);
      store = { rooms: {}, users: {}, records: [] };
    }
  }
}

function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// ========== Auth middleware ==========

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  const userId = req.headers['x-user-id'];
  const roomId = req.headers['x-room-id'];

  if (!token || !userId || !roomId) {
    return res.status(401).json({ error: '未登录，请先加入家庭房间' });
  }

  const user = store.users[userId];
  if (!user || user.token !== token || user.room_id !== roomId) {
    return res.status(401).json({ error: '认证失败，请重新加入房间' });
  }

  req.user = user;
  req.roomId = roomId;
  next();
}

// ========== API Routes ==========

// Create a family room
app.post('/api/rooms', (req, res) => {
  const { name, nickname } = req.body || {};
  const roomId = generateId();
  const userId = generateId();
  const token = generateId();
  let code;

  // Ensure unique code
  do {
    code = generateCode();
  } while (Object.values(store.rooms).some(r => r.code === code));

  const now = new Date().toISOString();
  const roomName = name || '宝宝';
  const userNickname = nickname || '爸爸';

  store.rooms[roomId] = { id: roomId, code, name: roomName, created_at: now };
  store.users[userId] = { id: userId, room_id: roomId, nickname: userNickname, token, created_at: now };
  saveStore();

  res.json({
    room: { id: roomId, code, name: roomName },
    user: { id: userId, nickname: userNickname, token }
  });
});

// Join a family room
app.post('/api/rooms/join', (req, res) => {
  const { code, nickname } = req.body || {};
  if (!code) return res.status(400).json({ error: '请输入房间码' });

  const room = Object.values(store.rooms).find(r => r.code === code);
  if (!room) return res.status(404).json({ error: '未找到该家庭房间，请检查房间码' });

  const existingMembers = Object.values(store.users)
    .filter(u => u.room_id === room.id)
    .map(u => u.nickname);

  const userId = generateId();
  const token = generateId();
  const now = new Date().toISOString();
  const userNickname = nickname || '奶奶';

  store.users[userId] = { id: userId, room_id: room.id, nickname: userNickname, token, created_at: now };
  saveStore();

  res.json({
    room: { id: room.id, code: room.code, name: room.name },
    user: { id: userId, nickname: userNickname, token },
    members: existingMembers
  });
});

// Get room info and members
app.get('/api/room', (req, res) => {
  authMiddleware(req, res, () => {
    const room = store.rooms[req.roomId];
    const users = Object.values(store.users)
      .filter(u => u.room_id === req.roomId)
      .map(u => ({ id: u.id, nickname: u.nickname, created_at: u.created_at }));
    res.json({
      room,
      users,
      me: { id: req.user.id, nickname: req.user.nickname }
    });
  });
});

// Get records for a specific date (all users merged)
app.get('/api/records/:date', (req, res) => {
  authMiddleware(req, res, () => {
    const { date } = req.params;

    const records = store.records
      .filter(r => r.room_id === req.roomId && r.date === date)
      .map(r => ({
        ...r,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      }));

    // Enrich with user nicknames
    const enriched = records.map(r => ({
      ...r,
      nickname: store.users[r.user_id]?.nickname || '未知'
    })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const merged = mergeRecords(enriched);

    res.json({
      date,
      merged,
      raw: enriched,
      contributors: [...new Set(enriched.map(r => r.nickname))]
    });
  });
});

// Save a record
app.post('/api/records', (req, res) => {
  authMiddleware(req, res, () => {
    const { date, section, data } = req.body;
    if (!date || !section) return res.status(400).json({ error: '缺少必要字段' });

    const now = new Date().toISOString();

    // Upsert: remove existing record from this user for this date+section
    store.records = store.records.filter(r =>
      !(r.room_id === req.roomId && r.user_id === req.user.id && r.date === date && r.section === section)
    );

    const recordId = generateId();
    store.records.push({
      id: recordId,
      room_id: req.roomId,
      user_id: req.user.id,
      date,
      section,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      updated_at: now
    });
    saveStore();

    // Return merged results
    const allRecords = store.records
      .filter(r => r.room_id === req.roomId && r.date === date)
      .map(r => ({
        ...r,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      }));

    const enriched = allRecords.map(r => ({
      ...r,
      nickname: store.users[r.user_id]?.nickname || '未知'
    })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    res.json({
      record: { id: recordId, section, data, updated_at: now },
      merged: mergeRecords(enriched),
      contributors: [...new Set(enriched.map(r => r.nickname))]
    });
  });
});

// Get history for charts
app.get('/api/history', (req, res) => {
  authMiddleware(req, res, () => {
    const { from, to, section } = req.query;

    let records = store.records.filter(r => r.room_id === req.roomId);

    if (from) records = records.filter(r => r.date >= from);
    if (to) records = records.filter(r => r.date <= to);
    if (section) records = records.filter(r => r.section === section);

    records.sort((a, b) => b.date.localeCompare(a.date));

    const byDate = {};
    for (const r of records) {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push({
        section: r.section,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      });
    }

    res.json({ history: byDate });
  });
});

// ========== Record Merging Logic ==========

function mergeRecords(records) {
  const merged = {};

  for (const r of records) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;

    if (!merged[r.section]) {
      merged[r.section] = { ...data, _contributors: [r.nickname] };
      continue;
    }

    const existing = merged[r.section];

    switch (r.section) {
      case 'feeding':
        for (const meal of Object.keys(data.meals || {})) {
          if (!existing.meals) existing.meals = {};
          if (!existing.meals[meal]) {
            existing.meals[meal] = data.meals[meal];
          } else {
            for (const item of Object.keys(data.meals[meal].items || {})) {
              if (!existing.meals[meal].items[item]) {
                existing.meals[meal].items[item] = data.meals[meal].items[item];
              } else {
                existing.meals[meal].items[item].qty =
                  Math.max(existing.meals[meal].items[item].qty || 0, data.meals[meal].items[item].qty || 0);
              }
            }
            existing.meals[meal].completed = existing.meals[meal].completed || data.meals[meal].completed;
          }
        }
        break;

      case 'activity':
        existing.outdoor_am = Math.max(existing.outdoor_am || 0, data.outdoor_am || 0);
        existing.outdoor_pm = Math.max(existing.outdoor_pm || 0, data.outdoor_pm || 0);
        existing.walking = Math.max(existing.walking || 0, data.walking || 0);
        if (data.games && Array.isArray(data.games)) {
          existing.games = [...new Set([...(existing.games || []), ...data.games])];
        }
        break;

      case 'sleep':
        existing.night = Math.max(existing.night || 0, data.night || 0);
        existing.nap_am = Math.max(existing.nap_am || 0, data.nap_am || 0);
        existing.nap_pm = Math.max(existing.nap_pm || 0, data.nap_pm || 0);
        break;

      case 'water':
        if (data.records && Array.isArray(data.records)) {
          existing.records = existing.records || [];
          const existingSlots = new Set(existing.records.map(x => x.slot));
          for (const rec of data.records) {
            if (!existingSlots.has(rec.slot)) {
              existing.records.push(rec);
              existingSlots.add(rec.slot);
            } else {
              const idx = existing.records.findIndex(x => x.slot === rec.slot);
              if (idx >= 0) {
                existing.records[idx].amount = Math.max(existing.records[idx].amount, rec.amount);
              }
            }
          }
        }
        break;

      case 'supplements':
        existing.ad = existing.ad || data.ad;
        existing.dha = existing.dha || data.dha;
        break;
    }

    if (!existing._contributors.includes(r.nickname)) {
      existing._contributors.push(r.nickname);
    }
  }

  return merged;
}

// Check server health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: Object.keys(store.rooms).length,
    users: Object.keys(store.users).length,
    records: store.records.length
  });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Start Server ==========

loadStore();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Baby Tracker server running on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
