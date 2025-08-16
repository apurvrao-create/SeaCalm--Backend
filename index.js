require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');


// Models
const User = require('./models/User');
const MoodEntry = require('./models/MoodEntry');


// Import admin routes
const adminRoutes = require('./admin.routes');

const app = express();


/* ========================  CORS CONFIG  ======================== */
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'https://seacalm.netlify.app']
}));



/* ========================  MIDDLEWARE  ======================== */
app.use(express.json());
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  next();
});


/* ========================  DB CONNECTION  ======================== */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));


/* ========================  AUTH MIDDLEWARE  ======================== */
const authenticate = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    console.error('❌ Auth Error:', err.message);
    res.status(401).json({ message: 'Invalid token' });
  }
};


/* ======================== ROUTES ======================== */


// Root check
app.get('/', (req, res) => res.send('SeaCalm API is running 🚀'));


// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    console.log('📥 /api/register:', req.body);
    let { email, password, name, rank, ship } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Please fill required fields' });
    }

    email = email.trim().toLowerCase();

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const role = (email === process.env.ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'crew';
    const isApproved = role === 'admin';

    const newUser = new User({ email, passwordHash, name, rank, ship, role, isApproved });
    await newUser.save();

    res.status(201).json({
      message: role === 'admin'
        ? 'Admin account created'
        : 'Registration complete, awaiting approval'
    });
  } catch (err) {
    console.error('❌ Register Error:', err);
    res.status(500).json({ message: err.message });
  }
});


// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    console.log('📥 /api/login:', req.body);
    let { email, password } = req.body;
    email = email.trim().toLowerCase();

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (user.role === 'crew' && !user.isApproved) {
      return res.status(403).json({ message: 'Not approved by admin yet' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        email: user.email,
        name: user.name,
        rank: user.rank,
        ship: user.ship,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ Login Error:', err);
    res.status(500).json({ message: err.message });
  }
});


// ADMIN ROUTES - Mounted here
app.use('/api/admin', authenticate, (req, res, next) => {
  // Only allow admin role to proceed
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: Admins only' });
  }
  next();
}, adminRoutes);


// CREW: Submit Mood
app.post('/api/moods', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'crew') return res.status(403).json({ message: 'Unauthorized' });

    const { moodAnswers, avgScore } = req.body;
    if (!moodAnswers || avgScore === undefined) {
      return res.status(400).json({ message: 'Missing mood data' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const exists = await MoodEntry.findOne({ userId: req.user._id, date: { $gte: today } });
    if (exists) return res.status(400).json({ message: 'Already submitted today' });

    await new MoodEntry({
      userId: req.user._id,
      date: today,
      moodAnswers,
      avgScore
    }).save();

    res.json({ message: 'Mood saved' });
  } catch (err) {
    console.error('❌ Submit Mood Error:', err);
    res.status(500).json({ message: err.message });
  }
});


// CREW: Get Past Moods
app.get('/api/moods', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'crew') return res.status(403).json({ message: 'Unauthorized' });

    const moods = await MoodEntry.find({ userId: req.user._id }).sort({ date: 1 }).lean();
    res.json(moods);
  } catch (err) {
    console.error('❌ Get Moods Error:', err);
    res.status(500).json({ message: err.message });
  }
});


/* ======================== START SERVER ======================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
