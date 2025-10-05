const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    role: {
        type: String,
        enum: ['learner', 'instructor', 'admin'],
        default: 'learner'
    },
    isVerified: {
        type: Boolean,
        default: function() {
            return this.role === 'learner' || this.role === 'admin';
        }
    },
    profile: {
        bio: String,
        avatar: String,
        phone: String,
        dateOfBirth: Date,
        country: String
    },
    instructor: {
        expertise: [String],
        experience: String,
        qualifications: String,
        verificationStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        },
        verifiedAt: Date,
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        totalStudents: {
            type: Number,
            default: 0
        },
        totalCourses: {
            type: Number,
            default: 0
        },
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        }
    },
    learner: {
        enrolledCourses: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course'
        }],
        completedCourses: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course'
        }],
        certificates: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Certificate'
        }],
        wishlist: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course'
        }],
        cart: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course'
        }],
        preferences: {
            categories: [String],
            difficulty: {
                type: String,
                enum: ['beginner', 'intermediate', 'advanced']
            }
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: Date,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Update timestamp on save
userSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Get public profile
userSchema.methods.getPublicProfile = function() {
    const userObject = this.toObject();
    delete userObject.password;
    return userObject;
};

module.exports = mongoose.model('User', userSchema);