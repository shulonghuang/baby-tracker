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

let store = { rooms: {}, users: {}, baby_profiles: {}, records: [] };

function loadStore() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!store.rooms) store.rooms = {};
      if (!store.users) store.users = {};
      if (!store.baby_profiles) store.baby_profiles = {};
      if (!store.records) store.records = [];
    } catch (e) {
      console.error('Failed to load data file, starting fresh:', e.message);
      store = { rooms: {}, users: {}, baby_profiles: {}, records: [] };
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

// Creator-only middleware
function creatorOnly(req, res, next) {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: '仅主账号可修改此设置' });
  }
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

  do {
    code = generateCode();
  } while (Object.values(store.rooms).some(r => r.code === code));

  const now = new Date().toISOString();
  const babyName = name || '宝宝';

  store.rooms[roomId] = { id: roomId, code, baby_name: babyName, created_at: now };
  store.users[userId] = { id: userId, room_id: roomId, nickname: nickname || '爸爸', token, role: 'creator', created_at: now };
  store.baby_profiles[roomId] = {
    name: babyName,
    birthday: '',
    created_by: userId
  };
  saveStore();

  res.json({
    room: { id: roomId, code, baby_name: babyName },
    user: { id: userId, nickname: nickname || '爸爸', token, role: 'creator' },
    baby: store.baby_profiles[roomId]
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
    .map(u => ({ nickname: u.nickname, role: u.role }));

  const userId = generateId();
  const token = generateId();
  const now = new Date().toISOString();

  store.users[userId] = {
    id: userId, room_id: room.id, nickname: nickname || '家人',
    token, role: 'member', created_at: now
  };
  saveStore();

  res.json({
    room: { id: room.id, code: room.code, baby_name: room.baby_name },
    user: { id: userId, nickname: nickname || '家人', token, role: 'member' },
    members: existingMembers,
    baby: store.baby_profiles[room.id] || null
  });
});

// Get room info and members
app.get('/api/room', (req, res) => {
  authMiddleware(req, res, () => {
    const room = store.rooms[req.roomId];
    const users = Object.values(store.users)
      .filter(u => u.room_id === req.roomId)
      .map(u => ({ id: u.id, nickname: u.nickname, role: u.role, created_at: u.created_at }));
    res.json({
      room,
      users,
      baby: store.baby_profiles[req.roomId] || null,
      me: { id: req.user.id, nickname: req.user.nickname, role: req.user.role }
    });
  });
});

// Get baby profile
app.get('/api/baby-profile', (req, res) => {
  authMiddleware(req, res, () => {
    const profile = store.baby_profiles[req.roomId] || { name: store.rooms[req.roomId]?.baby_name || '宝宝' };
    res.json(profile);
  });
});

// Update baby profile (creator only)
app.put('/api/baby-profile', (req, res) => {
  authMiddleware(req, res, () => {
    creatorOnly(req, res, () => {
      const { name, birthday } = req.body || {};
      if (!store.baby_profiles[req.roomId]) {
        store.baby_profiles[req.roomId] = { name: '宝宝', birthday: '', created_by: req.user.id };
      }
      if (name) {
        store.baby_profiles[req.roomId].name = name;
        // Also update room baby_name for backward compat
        if (store.rooms[req.roomId]) store.rooms[req.roomId].baby_name = name;
      }
      if (birthday !== undefined) store.baby_profiles[req.roomId].birthday = birthday;
      saveStore();
      res.json(store.baby_profiles[req.roomId]);
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

// Get feeding patterns for a room (last 14 days, for default suggestions)
app.get('/api/feeding-patterns', (req, res) => {
  authMiddleware(req, res, () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10);

    const feedingRecords = store.records
      .filter(r => r.room_id === req.roomId && r.section === 'feeding' && r.date >= fourteenDaysAgo)
      .map(r => ({
        date: r.date,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      }));

    // Analyze patterns
    const patterns = {};
    for (const record of feedingRecords) {
      const meals = record.data.meals || {};
      for (const [mealId, mealData] of Object.entries(meals)) {
        if (!mealData.time) continue;
        if (!patterns[mealId]) patterns[mealId] = { times: [], foods: {} };
        patterns[mealId].times.push(mealData.time);

        // Track food items
        const items = mealData.items || {};
        for (const [foodId, foodData] of Object.entries(items)) {
          if (foodData.checked) {
            if (!patterns[mealId].foods[foodId]) patterns[mealId].foods[foodId] = { count: 0, totalQty: 0 };
            patterns[mealId].foods[foodId].count++;
            patterns[mealId].foods[foodId].totalQty += (foodData.qty || 0);
          }
        }
      }
    }

    // Calculate averages
    const suggestions = {};
    for (const [mealId, p] of Object.entries(patterns)) {
      // Average time
      const avgMinutes = Math.round(
        p.times.reduce((sum, t) => {
          const [h, m] = t.split(':').map(Number);
          return sum + h * 60 + m;
        }, 0) / p.times.length
      );
      const avgH = String(Math.floor(avgMinutes / 60)).padStart(2, '0');
      const avgM = String(avgMinutes % 60).padStart(2, '0');

      // Top foods (sorted by frequency)
      const topFoods = Object.entries(p.foods)
        .map(([id, d]) => ({ id, avgQty: Math.round(d.totalQty / d.count), count: d.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      suggestions[mealId] = {
        avgTime: `${avgH}:${avgM}`,
        count: p.times.length,
        topFoods
      };
    }

    res.json({ suggestions });
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
            // Merge time: use earliest recorded time for the day
            const existingTime = existing.meals[meal].time;
            const newTime = data.meals[meal].time;
            if (existingTime && newTime) {
              existing.meals[meal].time = existingTime < newTime ? existingTime : newTime;
            } else if (newTime) {
              existing.meals[meal].time = newTime;
            }

            // Merge food items
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
