const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    certificateId: {
        type: String,
        required: true,
        unique: true
    },
    issuedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date,
        required: true
    },
    grade: {
        type: String,
        enum: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'Pass'],
        default: 'Pass'
    },
    skills: [String], // Skills acquired from the course
    
    // Certificate customization from course
    certificateData: {
        organizationName: String,
        logoUrl: String,
        signedBy: {
            name: String,
            title: String,
            signatureUrl: String
        },
        template: {
            type: String,
            enum: ['modern', 'classic', 'elegant', 'professional'],
            default: 'modern'
        }
    },
    
    metadata: {
        totalDuration: Number,
        completionTime: Number, // days taken to complete
        finalScore: Number,
        completionPercentage: Number,
        quizAverageScore: Number
    }
});

// Generate certificate ID
certificateSchema.pre('save', function(next) {
    if (!this.certificateId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.certificateId = `CERT-${timestamp}-${random}`;
    }
    next();
});

module.exports = mongoose.model('Certificate', certificateSchema);