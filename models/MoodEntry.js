const mongoose = require('mongoose');

const moodEntrySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  },
  date: { 
    type: Date,
    default: Date.now, // defaults to current date/time
    required: true
  },
  moodAnswers: { 
    type: Map, // store question->score pairs
    of: { type: Number, min: 1, max: 5 }, // validate range
    required: true
  },
  avgScore: { 
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  // Optional: pre‑computed distribution of moods for faster pie charts in admin UI
  moodCounts: {
    type: Map, // e.g., { "1": 2, "2": 5, "3": 3, "4": 4, "5": 1 }
    of: Number,
    default: {}
  }
}, { 
  timestamps: true // adds createdAt & updatedAt automatically
});

/* ===== Indexes for performance ===== */
// 1. One entry per user per day
moodEntrySchema.index({ userId: 1, date: 1 }, { unique: true });

// 2. AvgScore filter index for low mood detection
moodEntrySchema.index({ avgScore: 1 });

// 3. Ship filtering support (when populated with user.ship)
//    Compound index with date + avgScore for daily low mood checks
moodEntrySchema.index({ date: 1, avgScore: 1 });

module.exports = mongoose.model('MoodEntry', moodEntrySchema);

