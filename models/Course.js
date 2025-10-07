const mongoose = require('mongoose');

// Quiz question schema for quiz lectures
const quizQuestionSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['single', 'multiple'],
        required: true,
        default: 'single'
    },
    options: [{
        type: String,
        required: true,
        trim: true
    }],
    correctAnswers: [{
        type: Number, // Array of correct option indexes (0-based)
        required: true,
        min: 0
    }],
    explanation: {
        type: String,
        default: ''
    }
});

// Lecture schema supporting different types (Video, Quiz, Note)
const lectureSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    order: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['video', 'quiz', 'note'],
        required: true
    },
    isPreview: {
        type: Boolean,
        default: false
    },
    duration: {
        type: Number, // Duration in seconds (for videos) or estimated reading time (for notes)
        default: 0
    },
    
    // Video lecture specific fields
    video: {
        apiVideoId: {
            type: String, // API.video video ID
            default: null
        },
        embedUrl: {
            type: String, // API.video embed URL
            default: null
        },
        playerUrl: {
            type: String, // API.video player URL
            default: null
        },
        thumbnailUrl: {
            type: String, // API.video thumbnail URL
            default: null
        },
        hlsUrl: {
            type: String, // API.video HLS URL
            default: null
        },
        mp4Url: {
            type: String, // API.video MP4 URL
            default: null
        },
        duration: {
            type: Number, // Video duration in seconds
            default: 0
        },
        isProcessing: {
            type: Boolean,
            default: false
        }
    },
    
    // Quiz lecture specific fields
    quiz: {
        isGraded: {
            type: Boolean,
            default: false
        },
        instructions: {
            type: String,
            default: 'Choose the best answer for each question.'
        },
        timeLimit: {
            type: Number, // Time limit in minutes (0 = no limit)
            default: 0
        },
        passingScore: {
            type: Number, // Percentage required to pass
            default: 70
        },
        shuffleQuestions: {
            type: Boolean,
            default: false
        },
        showCorrectAnswers: {
            type: Boolean,
            default: true
        },
        questions: [quizQuestionSchema]
    },
    
    // Note lecture specific fields
    note: {
        content: {
            type: String, // Rich text content (HTML or Markdown)
            default: ''
        },
        attachments: [{
            name: String,
            url: String,
            type: {
                type: String,
                enum: ['pdf', 'doc', 'docx', 'txt', 'image', 'link', 'other'],
                default: 'other'
            },
            size: Number // File size in bytes
        }]
    },
    
    // Common resources for all lecture types
    resources: [{
        name: String,
        url: String,
        type: {
            type: String,
            enum: ['pdf', 'doc', 'zip', 'link', 'image', 'other'],
            default: 'other'
        },
        size: Number
    }]
}, { timestamps: true });

const sectionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    order: {
        type: Number,
        required: true
    },
    lectures: [lectureSchema] // Changed from 'lessons' to 'lectures'
}, { timestamps: true });

const courseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    shortDescription: {
        type: String,
        required: true
    },
    instructor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { 
            return this.status === 'published'; 
        }
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: function() { 
            return this.status === 'published'; 
        }
    },
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        required: function() { 
            return this.status === 'published'; 
        }
    },
    price: {
        type: Number,
        required: function() { 
            return this.status === 'published'; 
        },
        min: 0
    },
    originalPrice: {
        type: Number,
        default: function() {
            return this.price;
        }
    },
    currency: {
        type: String,
        default: 'USD'
    },
    language: {
        type: String,
        default: 'English'
    },
    
    // Course poster/thumbnail image
    thumbnail: {
        url: String,
        publicId: String // For cloud storage reference
    },
    
    // Course banner image
    banner: {
        url: String,
        publicId: String
    },
    
    // Demo video (30 second preview)
    demoVideo: {
        url: String,
        publicId: String,
        duration: {
            type: Number,
            max: 30 // Maximum 30 seconds
        }
    },
    
    // Certificate configuration
    certificate: {
        enabled: {
            type: Boolean,
            default: true
        },
        logo: {
            url: String, // Certificate logo/institution logo
            publicId: String
        },
        organizationName: {
            type: String,
            default: 'Online Learning Platform'
        },
        signedBy: {
            name: {
                type: String,
                required: function() { 
                    return this.certificate.enabled && this.status === 'published'; 
                }
            },
            title: {
                type: String,
                default: 'Course Instructor'
            },
            signature: {
                url: String, // Digital signature image
                publicId: String
            }
        },
        template: {
            type: String,
            enum: ['modern', 'classic', 'elegant', 'professional'],
            default: 'modern'
        },
        completionRequirement: {
            type: Number, // Percentage of course that must be completed
            default: 100,
            min: 50,
            max: 100
        },
        passingScore: {
            type: Number, // Minimum quiz average required (if applicable)
            default: 70,
            min: 0,
            max: 100
        }
    },
    
    // Course content
    sections: [sectionSchema],
    
    // Learning objectives
    whatYouWillLearn: [{
        type: String,
        required: true
    }],
    
    // Prerequisites
    requirements: [{
        type: String
    }],
    
    // Tags for search and categorization
    tags: [{
        type: String,
        lowercase: true
    }],
    
    // Publishing and visibility
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    isPublished: {
        type: Boolean,
        default: false
    },
    publishedAt: {
        type: Date
    },
    
    // Statistics
    enrolledStudents: {
        type: Number,
        default: 0
    },
    totalDuration: {
        type: Number, // Total course duration in seconds
        default: 0
    },
    totalLectures: {
        type: Number,
        default: 0
    },
    
    // Reviews and ratings
    ratings: {
        average: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        count: {
            type: Number,
            default: 0
        }
    },
    
    // Course status
    isActive: {
        type: Boolean,
        default: true
    },
    
    // SEO and metadata
    slug: {
        type: String,
        unique: true
    },
    metaDescription: String,
    metaKeywords: [String]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
courseSchema.index({ title: 'text', description: 'text', tags: 'text' });
courseSchema.index({ category: 1, level: 1 });
courseSchema.index({ instructor: 1 });
courseSchema.index({ isPublished: 1, isActive: 1 });
courseSchema.index({ 'ratings.average': -1 });
courseSchema.index({ createdAt: -1 });
courseSchema.index({ price: 1 });

// Virtual for discount percentage
courseSchema.virtual('discountPercentage').get(function() {
    if (this.originalPrice && this.originalPrice > this.price) {
        return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
    }
    return 0;
});

// Pre-save middleware to calculate totals
courseSchema.pre('save', function(next) {
    if (this.isModified('sections')) {
        let totalDuration = 0;
        let totalLectures = 0;
        
        this.sections.forEach(section => {
            section.lectures.forEach(lecture => {
                totalLectures++;
                if (lecture.type === 'video' && lecture.video.duration) {
                    totalDuration += lecture.video.duration;
                } else if (lecture.type === 'note' && lecture.note.estimatedReadTime) {
                    totalDuration += lecture.note.estimatedReadTime * 60; // Convert minutes to seconds
                }
            });
        });
        
        this.totalDuration = totalDuration;
        this.totalLectures = totalLectures;
    }
    
    // Generate slug if not provided
    if (!this.slug && this.title) {
        this.slug = this.title.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .trim();
    }
    
    next();
});

// Method to check if user can access the course
courseSchema.methods.canAccess = function(user) {
    if (!this.isPublished || !this.isActive) {
        // Only instructor and admin can access unpublished courses
        return user && (user._id.equals(this.instructor) || user.role === 'admin');
    }
    return true;
};

// Method to get course progress for a user
courseSchema.methods.getProgressForUser = async function(userId) {
    const Progress = mongoose.model('Progress');
    return await Progress.findOne({
        user: userId,
        course: this._id
    });
};

// Static method to get courses with filters
courseSchema.statics.findWithFilters = function(filters = {}) {
    const query = { isPublished: true, isActive: true };
    
    if (filters.category) query.category = filters.category;
    if (filters.level) query.level = filters.level;
    if (filters.instructor) query.instructor = filters.instructor;
    if (filters.minPrice !== undefined) query.price = { $gte: filters.minPrice };
    if (filters.maxPrice !== undefined) {
        query.price = query.price || {};
        query.price.$lte = filters.maxPrice;
    }
    if (filters.search) {
        query.$text = { $search: filters.search };
    }
    
    return this.find(query);
};

module.exports = mongoose.model('Course', courseSchema);