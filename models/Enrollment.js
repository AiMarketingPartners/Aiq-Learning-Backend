const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
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
    enrolledAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    progress: {
        completedLessons: [{
            sectionIndex: Number,
            lessonIndex: Number,
            completedAt: Date
        }],
        overallProgress: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        lastAccessedLesson: {
            sectionIndex: Number,
            lessonIndex: Number
        },
        totalTimeSpent: {
            type: Number,
            default: 0 // in seconds
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// Compound index to ensure one enrollment per user per course
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

// Calculate progress percentage based on duration
enrollmentSchema.methods.calculateProgress = async function() {
    const course = await mongoose.model('Course').findById(this.course);
    if (!course) return 0;
    
    let totalDuration = 0;
    let completedDuration = 0;
    
    // Calculate total duration and completed duration from all sections and lectures
    course.sections.forEach((section, sectionIndex) => {
        if (section.lectures) {
            section.lectures.forEach((lecture, lectureIndex) => {
                // Add lecture duration to total (use video duration for videos, or duration field for others)
                const lectureDuration = lecture.type === 'video' && lecture.video?.duration 
                    ? lecture.video.duration 
                    : lecture.duration || 0;
                totalDuration += lectureDuration;
                
                // Check if this lecture is completed
                const isCompleted = this.progress.completedLessons.some(
                    completed => completed.sectionIndex === sectionIndex && completed.lessonIndex === lectureIndex
                );
                
                if (isCompleted) {
                    completedDuration += lectureDuration;
                }
            });
        }
    });
    
    // Calculate percentage based on duration (fallback to lesson count if no durations)
    if (totalDuration > 0) {
        this.progress.overallProgress = Math.round((completedDuration / totalDuration) * 100);
    } else {
        // Fallback to lesson count based calculation
        const totalLessons = course.totalLessons;
        const completedLessons = this.progress.completedLessons.length;
        this.progress.overallProgress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    }
    
    // Mark as completed if 100%
    if (this.progress.overallProgress === 100 && !this.completedAt) {
        this.completedAt = new Date();
    }
    
    return this.progress.overallProgress;
};

module.exports = mongoose.model('Enrollment', enrollmentSchema);