console.log('admin.routes.js loaded');

const express = require('express');
const router = express.Router();
const User = require('./models/User');
const MoodEntry = require('./models/MoodEntry');

// Admin authorization middleware - requires req.user to be set by previous auth middleware
function adminAuth(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }
}

router.use(adminAuth);

// Helper: get start and end of current month as Date
function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

// 1. All Crew Check-In Status
router.get('/all-users-checkin', async (req, res) => {
  console.log('GET /api/admin/all-users-checkin HIT');
  try {
    // Find all users grouped by ship, only crew users
    const users = await User.find({ role: 'crew' }).lean();

    // Calculate coins and last check-in date per user for current month
    const { start, end } = getCurrentMonthRange();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Aggregate MoodEntry counts (coins) per user for current month
    const monthMoodEntries = await MoodEntry.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: "$userId", coinsSum: { $sum: 1 } } }
    ]);

    const coinsMap = {};
    monthMoodEntries.forEach(entry => {
      coinsMap[entry._id.toString()] = entry.coinsSum;
    });

    // Aggregate last mood check-in date per user
    const lastMoodChecks = await MoodEntry.aggregate([
      { $group: { _id: "$userId", lastCheckIn: { $max: "$date" } } }
    ]);

    const lastCheckMap = {};
    lastMoodChecks.forEach(entry => {
      lastCheckMap[entry._id.toString()] = entry.lastCheckIn.toISOString().slice(0, 10);
    });

    // Group users by ship with added info
    const grouped = {};
    users.forEach(u => {
      if (!grouped[u.ship]) grouped[u.ship] = [];
      const lastCheckDate = lastCheckMap[u._id.toString()] || null;
      const checkedInToday = lastCheckDate === todayStr;
      const monthlyCoins = coinsMap[u._id.toString()] || 0;
      grouped[u.ship].push({
        name: u.name,
        email: u.email,
        lastCheckInDate: lastCheckDate,
        checkedInToday,
        monthlyCoins,
        isApproved: u.isApproved
      });
    });

    res.json(grouped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 2. Pending and Approved Crew grouped by ship
router.get('/users', async (req, res) => {
  console.log('GET /api/admin/users HIT');
  try {
    const crew = await User.find({ role: 'crew' }).select('-passwordHash').lean();

    const grouped = crew.reduce((acc, u) => {
      acc[u.ship] = acc[u.ship] || [];
      acc[u.ship].push(u);
      return acc;
    }, {});

    res.json(grouped);
  } catch (err) {
    console.error('❌ View Crew Error:', err);
    res.status(500).json({ message: err.message });
  }
});

// 3. Monthly Coins Leaderboard
router.get('/monthly-coins-leaderboard', async (req, res) => {
  try {
    const { start, end } = getCurrentMonthRange();

    const moods = await MoodEntry.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      { $group: { _id: "$user.ship", totalCoins: { $sum: 1 } } }
    ]);

    const coinsByShip = {};
    moods.forEach(m => {
      coinsByShip[m._id] = m.totalCoins;
    });

    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

    const lastMonthMoods = await MoodEntry.aggregate([
      { $match: { date: { $gte: lastMonthStart, $lt: lastMonthEnd } } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      { $group: { _id: "$user.ship", totalCoins: { $sum: 1 } } }
    ]);

    let lastMonthWinner = null;
    if (lastMonthMoods.length > 0) {
      lastMonthMoods.sort((a, b) => b.totalCoins - a.totalCoins);
      lastMonthWinner = lastMonthMoods[0]._id;
    }

    res.json({ coinsByShip, lastMonthWinner });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 4. Ships list for dropdown
router.get('/ships', async (req, res) => {
  try {
    const ships = await User.distinct("ship");
    res.json(ships);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 5. Mood Reports For Ship
router.get('/moods/:ship', async (req, res) => {
  const ship = req.params.ship;
  try {
    const moods = await MoodEntry.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      { $match: { "user.ship": ship } },
      {
        $group: {
          _id: "$date",
          averageMood: { $avg: "$avgScore" },
          moodCounts: { $push: "$avgScore" }
        }
      },
      {
        $project: {
          date: "$_id",
          averageMood: 1,
          moodCounts: 1,
          _id: 0
        }
      },
      { $sort: { date: 1 } }
    ]);
    res.json(moods);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});
// Approve or deny crew member (POST /api/admin/approve/:id)
router.post('/approve/:id', async (req, res) => {
  try {
    const { approve } = req.body; // expects { approve: true/false }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isApproved = !!approve;
    await user.save();

    res.json({ message: approve ? 'User approved.' : 'User denied.' });
  } catch (err) {
    console.error('❌ Approve user error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete crew member (DELETE /api/admin/users/:id)
router.delete('/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('❌ Delete user error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
