const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
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
    completionPercentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    completedAt: {
        type: Date
    },
    completionTime: {
        type: Number, // Total time spent in seconds
        default: 0
    },
    quizScores: [{
        sectionIndex: {
            type: Number,
            required: true
        },
        lectureIndex: {
            type: Number,
            required: true
        },
        quizId: {
            type: String,
            required: true
        },
        score: {
            type: Number,
            required: true,
            min: 0,
            max: 100
        },
        completedAt: {
            type: Date,
            default: Date.now
        },
        answers: [{
            questionIndex: Number,
            selectedAnswer: mongoose.Schema.Types.Mixed, // Can be string or array for multiple choice
            isCorrect: Boolean
        }]
    }],
    completedLessons: [{
        sectionIndex: {
            type: Number,
            required: true
        },
        lectureIndex: {
            type: Number,
            required: true
        },
        completedAt: {
            type: Date,
            default: Date.now
        },
        timeSpent: {
            type: Number, // Time spent in seconds
            default: 0
        }
    }],
    lastAccessedLesson: {
        sectionIndex: Number,
        lectureIndex: Number,
        accessedAt: {
            type: Date,
            default: Date.now
        }
    },
    totalTimeSpent: {
        type: Number,
        default: 0 // Total time spent in seconds
    }
}, {
    timestamps: true
});

// Compound index to ensure one progress record per user per course
progressSchema.index({ user: 1, course: 1 }, { unique: true });

// Method to calculate completion percentage
progressSchema.methods.calculateCompletionPercentage = async function() {
    try {
        const Course = require('./Course');
        const course = await Course.findById(this.course);
        
        if (!course || !course.sections || course.sections.length === 0) {
            return 0;
        }

        let totalLessons = 0;
        course.sections.forEach(section => {
            if (section.lectures && section.lectures.length > 0) {
                totalLessons += section.lectures.length;
            }
        });

        if (totalLessons === 0) {
            return 0;
        }

        const completedLessonsCount = this.completedLessons.length;
        const percentage = Math.round((completedLessonsCount / totalLessons) * 100);
        
        this.completionPercentage = percentage;
        
        // Mark as completed if 100%
        if (percentage === 100 && !this.completedAt) {
            this.completedAt = new Date();
        }
        
        return percentage;
    } catch (error) {
        console.error('Error calculating completion percentage:', error);
        return this.completionPercentage || 0;
    }
};

// Method to add quiz score
progressSchema.methods.addQuizScore = function(sectionIndex, lectureIndex, quizId, score, answers) {
    // Remove existing quiz score for the same quiz
    this.quizScores = this.quizScores.filter(qs => 
        !(qs.sectionIndex === sectionIndex && 
          qs.lectureIndex === lectureIndex && 
          qs.quizId === quizId)
    );
    
    // Add new quiz score
    this.quizScores.push({
        sectionIndex,
        lectureIndex,
        quizId,
        score,
        answers,
        completedAt: new Date()
    });
    
    return this.save();
};

// Method to mark lesson as completed
progressSchema.methods.completeLesson = async function(sectionIndex, lectureIndex, timeSpent = 0) {
    // Check if lesson is already completed
    const existingCompletion = this.completedLessons.find(cl => 
        cl.sectionIndex === sectionIndex && cl.lectureIndex === lectureIndex
    );
    
    if (!existingCompletion) {
        this.completedLessons.push({
            sectionIndex,
            lectureIndex,
            completedAt: new Date(),
            timeSpent
        });
    } else {
        // Update time spent if lesson already completed
        existingCompletion.timeSpent += timeSpent;
    }
    
    // Update last accessed lesson
    this.lastAccessedLesson = {
        sectionIndex,
        lectureIndex,
        accessedAt: new Date()
    };
    
    // Update total time spent
    this.totalTimeSpent += timeSpent;
    this.completionTime = this.totalTimeSpent;
    
    // Recalculate completion percentage
    await this.calculateCompletionPercentage();
    
    return this.save();
};

module.exports = mongoose.model('Progress', progressSchema);