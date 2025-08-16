const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, // ensures case-insensitive lookups
    trim: true       // removes accidental spaces
  },
  passwordHash: { 
    type: String, 
    required: true 
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  rank: { 
    type: String, 
    trim: true 
  },
  ship: { 
    type: String,
    trim: true
    // optional: enum: ['Abrao Cochin', 'SJ Lily', 'Corsica'] // you can enable this to lock values
  },
  isApproved: { 
    type: Boolean, 
    default: false 
  },
  role: { 
    type: String, 
    enum: ['crew', 'admin'], 
    default: 'crew' 
  },
  // Optional: store profile images for future avatar usage
  profileImage: { 
    type: String, 
    default: '' 
  }
}, 
{ 
  timestamps: true 
});

// Index email for faster login queries
userSchema.index({ email: 1 });

// Index role for faster admin queries
userSchema.index({ role: 1 });

// Compound index for ship + role queries (used in admin dashboards & reports)
userSchema.index({ ship: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);
