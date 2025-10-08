const mongoose = require('mongoose');

const quizAttemptSchema = new mongoose.Schema({
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
    lecture: {
        type: mongoose.Schema.Types.ObjectId,
        required: true // This will be the lecture ID within the course
    },
    lectureTitle: {
        type: String,
        required: true
    },
    answers: [{
        questionIndex: {
            type: Number,
            required: true
        },
        selectedAnswers: [{
            type: Number, // Array of selected option indices
            required: true
        }],
        isCorrect: {
            type: Boolean,
            required: true
        }
    }],
    score: {
        type: Number, // Percentage score (0-100)
        required: true
    },
    totalQuestions: {
        type: Number,
        required: true
    },
    correctAnswers: {
        type: Number,
        required: true
    },
    passed: {
        type: Boolean,
        default: null // null for ungraded quizzes
    },
    passingScore: {
        type: Number, // Required passing percentage
        default: null // null for ungraded quizzes
    },
    isGraded: {
        type: Boolean,
        required: true
    },
    timeTaken: {
        type: Number, // Time in seconds
        default: 0
    },
    completedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for efficient queries
quizAttemptSchema.index({ user: 1, course: 1, lecture: 1 });
quizAttemptSchema.index({ user: 1, course: 1 });
quizAttemptSchema.index({ course: 1, lecture: 1 });

// Virtual for attempt number (how many times user attempted this quiz)
quizAttemptSchema.virtual('attemptNumber').get(function() {
    // This would be calculated when querying
    return this._attemptNumber || 1;
});

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);