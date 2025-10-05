const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body } = require('express-validator');
const Course = require('../models/Course');
const Category = require('../models/Category');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const { authenticateToken, requireVerifiedInstructor, optionalAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadDir;
        
        switch (file.fieldname) {
            case 'thumbnail':
                uploadDir = 'uploads/course-posters';
                break;
            case 'banner':
                uploadDir = 'uploads/course-banners';
                break;
            case 'demoVideo':
                uploadDir = 'uploads/demo-videos';
                break;
            default:
                uploadDir = 'uploads/misc';
        }
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for demo videos
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'demoVideo') {
            if (file.mimetype.startsWith('video/')) {
                cb(null, true);
            } else {
                cb(new Error('Demo video must be a video file'), false);
            }
        } else if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Get instructor dashboard stats
router.get('/instructor/dashboard-stats',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const instructorId = req.user._id;

            // Get courses statistics
            const publishedCourses = await Course.find({ 
                instructor: instructorId, 
                status: 'published' 
            }).populate('category', 'name');

            const draftCourses = await Course.find({ 
                instructor: instructorId, 
                status: 'draft' 
            }).populate('category', 'name');

            // Calculate total students across all courses
            const totalStudents = await Enrollment.aggregate([
                {
                    $lookup: {
                        from: 'courses',
                        localField: 'course',
                        foreignField: '_id',
                        as: 'courseData'
                    }
                },
                {
                    $match: {
                        'courseData.0.instructor': instructorId
                    }
                },
                {
                    $count: 'totalStudents'
                }
            ]);

            // Calculate overall rating
            const overallRating = publishedCourses.length > 0 
                ? publishedCourses.reduce((sum, course) => sum + (course.ratings?.average || 0), 0) / publishedCourses.length
                : 0;

            // Recent activity - new enrollments and reviews (mock for now)
            const recentActivity = await Enrollment.find()
                .populate('user', 'name')
                .populate('course', 'title instructor')
                .sort('-createdAt')
                .limit(10)
                .then(enrollments => 
                    enrollments
                        .filter(enrollment => enrollment.course?.instructor?.toString() === instructorId)
                        .map(enrollment => ({
                            type: 'enrollment',
                            userId: enrollment.user._id,
                            userName: enrollment.user.name,
                            courseId: enrollment.course._id,
                            courseTitle: enrollment.course.title,
                            timestamp: enrollment.createdAt
                        }))
                );

            res.json({
                publishedCourses: publishedCourses.length,
                draftCourses: draftCourses.length,
                totalStudents: totalStudents[0]?.totalStudents || 0,
                overallRating: parseFloat(overallRating.toFixed(1)),
                recentActivity: recentActivity.slice(0, 5)
            });
        } catch (error) {
            console.error('Dashboard stats error:', error);
            res.status(500).json({ message: 'Failed to fetch dashboard stats' });
        }
    }
);

// Get all published courses (for students to browse)
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 12, 
            category, 
            search, 
            sortBy = 'createdAt', 
            sortOrder = 'desc' 
        } = req.query;

        // Build filter for published courses only
        const filter = { 
            status: 'published',
            isPublished: true 
        };

        // Add category filter if specified
        if (category && category !== 'all') {
            filter.category = category;
        }

        // Add search filter if specified
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (page - 1) * parseInt(limit);
        
        // Sort options
        const sortOptions = {};
        if (sortBy === 'rating') {
            sortOptions['ratings.average'] = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'price') {
            sortOptions.price = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'students') {
            sortOptions.enrolledStudents = sortOrder === 'desc' ? -1 : 1;
        } else {
            sortOptions.createdAt = sortOrder === 'desc' ? -1 : 1;
        }

        const courses = await Course.find(filter)
            .populate('category', 'name')
            .populate('instructor', 'name profileImage')
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .select('title description thumbnail banner price enrolledStudents totalLectures totalDuration ratings createdAt instructor category');

        const totalCourses = await Course.countDocuments(filter);

        res.json({
            courses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCourses,
                pages: Math.ceil(totalCourses / limit)
            }
        });
    } catch (error) {
        console.error('Get all courses error:', error);
        res.status(500).json({ message: 'Failed to fetch courses' });
    }
});

// Get instructor's courses (instructor-specific)
router.get('/instructor/my-courses',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const instructorId = req.user._id;
            const { status, page = 1, limit = 10 } = req.query;

            const filter = { instructor: instructorId };
            if (status && ['draft', 'published'].includes(status)) {
                filter.status = status;
            }

            const skip = (page - 1) * limit;

            const courses = await Course.find(filter)
                .populate('category', 'name')
                .sort('-createdAt')
                .skip(skip)
                .limit(parseInt(limit))
                .select('title description thumbnail banner status createdAt updatedAt price enrolledStudents totalLectures totalDuration ratings');

            const totalCourses = await Course.countDocuments(filter);

            res.json({
                courses,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCourses,
                    pages: Math.ceil(totalCourses / limit)
                }
            });
        } catch (error) {
            console.error('Get my courses error:', error);
            res.status(500).json({ message: 'Failed to fetch courses' });
        }
    }
);

// Create draft course (Step 1: Basic Info)
router.post('/draft',
    authenticateToken,
    requireVerifiedInstructor,
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'banner', maxCount: 1 },
        { name: 'demoVideo', maxCount: 1 }
    ]),
    [
        body('title').notEmpty().withMessage('Title is required'),
        body('description').notEmpty().withMessage('Description is required'),
        body('category').notEmpty().withMessage('Category is required'),
        body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('whatYouWillLearn').custom((value) => {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('At least one learning objective is required');
            }
            return true;
        })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const {
                title,
                description,
                category,
                price,
                whatYouWillLearn,
                requirements
            } = req.body;

            // Verify category exists
            const categoryDoc = await Category.findById(category);
            if (!categoryDoc) {
                return res.status(400).json({ message: 'Invalid category' });
            }

            // Prepare course data
            const courseData = {
                title,
                description,
                shortDescription: description.length > 200 ? description.substring(0, 200) + '...' : description,
                instructor: req.user._id,
                category,
                level: req.body.level || 'beginner',
                price: parseFloat(price),
                originalPrice: parseFloat(price),
                whatYouWillLearn: JSON.parse(whatYouWillLearn),
                requirements: requirements ? JSON.parse(requirements) : [],
                status: 'draft',
                isPublished: false
            };

            // Handle sections if provided
            if (req.body.sections) {
                try {
                    let sections = JSON.parse(req.body.sections);
                    if (Array.isArray(sections)) {
                        sections = sections.map((section, sectionIndex) => {
                            // Ensure section has order field
                            if (!section.order) {
                                section.order = sectionIndex + 1;
                            }
                            
                            // Ensure lectures have order field and proper structure
                            if (section.lectures && Array.isArray(section.lectures)) {
                                section.lectures = section.lectures.map((lecture, lectureIndex) => {
                                    if (!lecture.order) {
                                        lecture.order = lectureIndex + 1;
                                    }

                                    // Handle quiz lectures properly
                                    if (lecture.type === 'quiz' && lecture.questions) {
                                        // Convert frontend quiz format to backend format
                                        const quizQuestions = lecture.questions.map(q => ({
                                            question: q.text,
                                            type: q.type === 'single-choice' ? 'single' : 'multiple',
                                            options: q.options.map(opt => opt.text),
                                            correctAnswers: q.options
                                                .map((opt, idx) => opt.isCorrect ? idx : null)
                                                .filter(idx => idx !== null)
                                        }));

                                        lecture.quiz = {
                                            isGraded: lecture.graded || false,
                                            passingScore: lecture.graded ? (lecture.passingScore || 75) : 0,
                                            questions: quizQuestions
                                        };

                                        // Remove frontend-specific fields
                                        delete lecture.questions;
                                        delete lecture.graded;
                                        delete lecture.passingScore;
                                    }

                                    // Handle note lectures properly
                                    if (lecture.type === 'note' && lecture.content) {
                                        // Convert frontend note format to backend format
                                        lecture.note = {
                                            content: lecture.content,
                                            attachments: lecture.attachments || []
                                        };

                                        // Remove frontend-specific field
                                        delete lecture.content;
                                    }

                                    return lecture;
                                });
                            }
                            
                            return section;
                        });
                        courseData.sections = sections;
                    }
                } catch (e) {
                    console.log('Error parsing sections:', e);
                    // If sections can't be parsed, just ignore them for now
                }
            }

            // Handle file uploads
            if (req.files) {
                if (req.files.thumbnail) {
                    courseData.thumbnail = {
                        url: `/uploads/course-posters/${req.files.thumbnail[0].filename}`,
                        publicId: req.files.thumbnail[0].filename
                    };
                }
                
                if (req.files.banner) {
                    courseData.banner = {
                        url: `/uploads/course-banners/${req.files.banner[0].filename}`,
                        publicId: req.files.banner[0].filename
                    };
                }
                
                if (req.files.demoVideo) {
                    courseData.demoVideo = {
                        url: `/uploads/demo-videos/${req.files.demoVideo[0].filename}`,
                        publicId: req.files.demoVideo[0].filename
                    };
                }
            }

            const course = new Course(courseData);
            await course.save();

            // Populate the course with category details before returning
            await course.populate('category', 'name');
            
            // Transform quiz data from backend format to frontend format
            if (course.sections && course.sections.length > 0) {
                course.sections = course.sections.map(section => {
                    if (section.lectures && section.lectures.length > 0) {
                        section.lectures = section.lectures.map(lecture => {
                            if (lecture.type === 'quiz' && lecture.quiz) {
                                // Convert backend quiz format to frontend format
                                lecture.questions = lecture.quiz.questions.map(q => ({
                                    text: q.question,
                                    type: q.type === 'single' ? 'single-choice' : 'multiple-choice',
                                    options: q.options.map((optText, idx) => ({
                                        text: optText,
                                        isCorrect: q.correctAnswers.includes(idx)
                                    }))
                                }));
                                
                                lecture.graded = lecture.quiz.isGraded;
                                lecture.passingScore = lecture.quiz.passingScore;
                                
                                // Remove backend quiz object to avoid duplication
                                delete lecture.quiz;
                            }

                            if (lecture.type === 'note' && lecture.note) {
                                // Convert backend note format to frontend format
                                lecture.content = lecture.note.content || '';
                                lecture.attachments = lecture.note.attachments || [];
                                
                                // Remove backend note object to avoid duplication
                                delete lecture.note;
                            }
                            return lecture;
                        });
                    }
                    return section;
                });
            }
            
            res.status(201).json({
                message: 'Course draft created successfully',
                course: course
            });
        } catch (error) {
            console.error('Create draft course error:', error);
            res.status(500).json({ 
                message: 'Failed to create course draft',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Update course basic info
router.put('/:courseId/basic-info',
    authenticateToken,
    requireVerifiedInstructor,
    upload.fields([
        { name: 'thumbnail', maxCount: 1 },
        { name: 'banner', maxCount: 1 },
        { name: 'demoVideo', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { courseId } = req.params;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            console.log('📝 Basic-info update request:', {
                courseId,
                isPublished: req.body.isPublished,
                currentStatus: course.status,
                currentIsPublished: course.isPublished
            });

            // Special handling for isPublished FIRST - before other field processing
            if (req.body.isPublished !== undefined) {
                const isPublished = req.body.isPublished === 'true' || req.body.isPublished === true;
                course.isPublished = isPublished;
                course.status = isPublished ? 'published' : 'draft';
                
                if (isPublished && !course.publishedAt) {
                    course.publishedAt = new Date();
                } else if (!isPublished) {
                    course.publishedAt = undefined;
                }
                
                // Ensure certificate.signedBy.name is set when publishing
                if (isPublished && course.certificate.enabled && !course.certificate.signedBy.name) {
                    // Get instructor name as default
                    const instructor = await User.findById(course.instructor);
                    course.certificate.signedBy.name = instructor ? instructor.name : 'Course Instructor';
                    console.log('📝 Set default certificate signedBy name:', course.certificate.signedBy.name);
                }
                
                console.log('📝 Updated publish status:', { isPublished, status: course.status, publishedAt: course.publishedAt });
            }

            // Update basic fields
            const allowedFields = ['title', 'description', 'category', 'price', 'whatYouWillLearn', 'requirements', 'level', 'sections'];
            allowedFields.forEach(field => {
                if (req.body[field] !== undefined) {
                    if (['whatYouWillLearn', 'requirements', 'sections'].includes(field)) {
                        try {
                            let parsedValue = JSON.parse(req.body[field]);
                            
                            // Special handling for sections to ensure order fields
                            if (field === 'sections' && Array.isArray(parsedValue)) {
                                parsedValue = parsedValue.map((section, sectionIndex) => {
                                    // Ensure section has order field
                                    if (!section.order) {
                                        section.order = sectionIndex + 1;
                                    }
                                    
                                    // Ensure lectures have order field and handle quiz data
                                    if (section.lectures && Array.isArray(section.lectures)) {
                                        section.lectures = section.lectures.map((lecture, lectureIndex) => {
                                            if (!lecture.order) {
                                                lecture.order = lectureIndex + 1;
                                            }

                                            // Handle quiz lectures properly
                                            if (lecture.type === 'quiz' && lecture.questions) {
                                                // Convert frontend quiz format to backend format
                                                const quizQuestions = lecture.questions.map(q => ({
                                                    question: q.text,
                                                    type: q.type === 'single-choice' ? 'single' : 'multiple',
                                                    options: q.options.map(opt => opt.text),
                                                    correctAnswers: q.options
                                                        .map((opt, idx) => opt.isCorrect ? idx : null)
                                                        .filter(idx => idx !== null)
                                                }));

                                                lecture.quiz = {
                                                    isGraded: lecture.graded || false,
                                                    passingScore: lecture.graded ? (lecture.passingScore || 75) : 0,
                                                    questions: quizQuestions
                                                };

                                                // Remove frontend-specific fields
                                                delete lecture.questions;
                                                delete lecture.graded;
                                                delete lecture.passingScore;
                                            }

                                            // Handle note lectures properly
                                            if (lecture.type === 'note' && lecture.content) {
                                                // Convert frontend note format to backend format
                                                lecture.note = {
                                                    content: lecture.content,
                                                    attachments: lecture.attachments || []
                                                };

                                                // Remove frontend-specific field
                                                delete lecture.content;
                                            }

                                            return lecture;
                                        });
                                    }
                                    
                                    return section;
                                });
                            }
                            
                            course[field] = parsedValue;
                        } catch (e) {
                            // If it's not a valid JSON, it might be an object already
                            course[field] = req.body[field];
                        }
                    } else {
                        course[field] = req.body[field];
                    }
                }
            });

            // Handle file uploads
            if (req.files) {
                if (req.files.thumbnail) {
                    course.thumbnail = {
                        url: `/uploads/course-posters/${req.files.thumbnail[0].filename}`,
                        publicId: req.files.thumbnail[0].filename
                    };
                }
                
                if (req.files.banner) {
                    course.banner = {
                        url: `/uploads/course-banners/${req.files.banner[0].filename}`,
                        publicId: req.files.banner[0].filename
                    };
                }
                
                if (req.files.demoVideo) {
                    course.demoVideo = {
                        url: `/uploads/demo-videos/${req.files.demoVideo[0].filename}`,
                        publicId: req.files.demoVideo[0].filename
                    };
                }
            }

            await course.save();

            // Transform quiz data from backend format to frontend format
            if (course.sections && course.sections.length > 0) {
                course.sections = course.sections.map(section => {
                    if (section.lectures && section.lectures.length > 0) {
                        section.lectures = section.lectures.map(lecture => {
                            if (lecture.type === 'quiz' && lecture.quiz) {
                                // Convert backend quiz format to frontend format
                                lecture.questions = lecture.quiz.questions.map(q => ({
                                    text: q.question,
                                    type: q.type === 'single' ? 'single-choice' : 'multiple-choice',
                                    options: q.options.map((optText, idx) => ({
                                        text: optText,
                                        isCorrect: q.correctAnswers.includes(idx)
                                    }))
                                }));
                                
                                lecture.graded = lecture.quiz.isGraded;
                                lecture.passingScore = lecture.quiz.passingScore;
                                
                                // Remove backend quiz object to avoid duplication
                                delete lecture.quiz;
                            }

                            if (lecture.type === 'note' && lecture.note) {
                                // Convert backend note format to frontend format
                                lecture.content = lecture.note.content || '';
                                lecture.attachments = lecture.note.attachments || [];
                                
                                // Remove backend note object to avoid duplication
                                delete lecture.note;
                            }
                            return lecture;
                        });
                    }
                    return section;
                });
            }

            res.json({
                message: 'Course basic info updated successfully',
                course
            });
        } catch (error) {
            console.error('Update course basic info error:', error);
            res.status(500).json({ message: 'Failed to update course basic info' });
        }
    }
);

// Add section to course
router.post('/:courseId/sections',
    authenticateToken,
    requireVerifiedInstructor,
    [
        body('title').notEmpty().withMessage('Section title is required')
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { courseId } = req.params;
            const { title, description } = req.body;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            const newSection = {
                title,
                description: description || '',
                order: course.sections.length + 1,
                lectures: []
            };

            course.sections.push(newSection);
            await course.save();

            res.status(201).json({
                message: 'Section added successfully',
                section: course.sections[course.sections.length - 1]
            });
        } catch (error) {
            console.error('Add section error:', error);
            res.status(500).json({ message: 'Failed to add section' });
        }
    }
);

// Upload video for lecture
router.post('/:courseId/sections/:sectionId/lectures/:lectureId/upload-video',
    authenticateToken,
    requireVerifiedInstructor,
    upload.fields([
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 }
    ]),
    async (req, res) => {
        console.log('🎥 VIDEO UPLOAD REQUEST RECEIVED');
        console.log('Course ID:', req.params.courseId);
        console.log('Section ID:', req.params.sectionId);
        console.log('Lecture ID:', req.params.lectureId);
        console.log('Files received:', req.files ? Object.keys(req.files) : 'No files');
        
        try {
            const { courseId, sectionId, lectureId } = req.params;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            const section = course.sections.id(sectionId);
            if (!section) {
                return res.status(404).json({ message: 'Section not found' });
            }

            const lecture = section.lectures.id(lectureId);
            if (!lecture) {
                return res.status(404).json({ message: 'Lecture not found' });
            }

            if (lecture.type !== 'video') {
                return res.status(400).json({ message: 'Lecture must be of type video' });
            }

            if (!req.files || !req.files.video) {
                return res.status(400).json({ message: 'Video file is required' });
            }

            const VideoService = require('../services/VideoService');
            const videoService = new VideoService();

            // Create video in api.video
            console.log('📹 Creating video in api.video...');
            const createResult = await videoService.createVideo({
                title: lecture.title,
                description: lecture.description || '',
                isPublic: false,
                tags: [course.title, 'lecture'],
                metadata: [
                    { key: 'courseId', value: courseId },
                    { key: 'sectionId', value: sectionId },
                    { key: 'lectureId', value: lectureId },
                    { key: 'instructor', value: req.user.name || 'Unknown' }
                ]
            });

            console.log('📹 api.video create result:', createResult.success ? 'SUCCESS' : 'FAILED');
            if (createResult.success) {
                console.log('📹 Video ID:', createResult.video.videoId);
            }

            if (!createResult.success) {
                console.error('❌ Failed to create video in api.video:', createResult.error);
                return res.status(400).json({
                    message: 'Failed to create video in api.video',
                    error: createResult.error
                });
            }

            // Upload video file
            console.log('📤 Starting video file upload to api.video...');
            console.log('📤 File path:', req.files.video[0].path);
            console.log('📤 File size:', req.files.video[0].size, 'bytes');
            
            const uploadResult = await videoService.uploadVideo(
                createResult.video.videoId,
                req.files.video[0].path,
                (event) => {
                    const progress = (event.currentChunk / event.chunksCount) * 100;
                    console.log(`📤 Upload progress for lecture ${lectureId}: ${progress.toFixed(2)}%`);
                }
            );

            console.log('📤 Video upload result:', uploadResult.success ? 'SUCCESS' : 'FAILED');

            // Clean up local video file
            const fs = require('fs');
            if (fs.existsSync(req.files.video[0].path)) {
                fs.unlinkSync(req.files.video[0].path);
            }

            if (!uploadResult.success) {
                return res.status(400).json({
                    message: 'Failed to upload video file',
                    error: uploadResult.error
                });
            }

            // Upload thumbnail if provided
            if (req.files.thumbnail) {
                const thumbnailResult = await videoService.uploadThumbnail(
                    createResult.video.videoId,
                    req.files.thumbnail[0].path
                );

                // Clean up local thumbnail file
                if (fs.existsSync(req.files.thumbnail[0].path)) {
                    fs.unlinkSync(req.files.thumbnail[0].path);
                }

                if (thumbnailResult.success) {
                    uploadResult.video.thumbnailUrl = thumbnailResult.video.thumbnailUrl;
                }
            }

            // Update lecture with video data
            lecture.video = {
                apiVideoId: uploadResult.video.videoId,
                embedUrl: uploadResult.video.embedUrl,
                playerUrl: uploadResult.video.playerUrl,
                thumbnailUrl: uploadResult.video.thumbnailUrl,
                hlsUrl: uploadResult.video.hlsUrl,
                mp4Url: uploadResult.video.mp4Url,
                duration: uploadResult.video.duration || 0,
                isProcessing: false
            };

            // Update lecture duration with video duration
            if (uploadResult.video.duration) {
                lecture.duration = Math.ceil(uploadResult.video.duration / 60); // Convert to minutes
            }

            await course.save();

            res.json({
                message: 'Video uploaded successfully',
                lecture: lecture,
                videoData: uploadResult.video
            });

        } catch (error) {
            console.error('Upload lecture video error:', error);
            
            // Clean up local files if they exist
            const fs = require('fs');
            if (req.files) {
                if (req.files.video && fs.existsSync(req.files.video[0].path)) {
                    fs.unlinkSync(req.files.video[0].path);
                }
                if (req.files.thumbnail && fs.existsSync(req.files.thumbnail[0].path)) {
                    fs.unlinkSync(req.files.thumbnail[0].path);
                }
            }

            res.status(500).json({ 
                message: 'Failed to upload video',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Add lecture to section
router.post('/:courseId/sections/:sectionId/lectures',
    authenticateToken,
    requireVerifiedInstructor,
    [
        body('title').notEmpty().withMessage('Lecture title is required'),
        body('type').isIn(['video', 'quiz', 'note']).withMessage('Valid lecture type is required'),
        body('duration').isInt({ min: 1 }).withMessage('Duration must be at least 1 minute')
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { courseId, sectionId } = req.params;
            const { title, type, duration, description } = req.body;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            const section = course.sections.id(sectionId);
            if (!section) {
                return res.status(404).json({ message: 'Section not found' });
            }

            const newLecture = {
                title,
                type,
                duration,
                description: description || '',
                order: section.lectures.length + 1
            };

            // Initialize type-specific fields
            switch (type) {
                case 'video':
                    newLecture.video = {
                        apiVideoId: null,
                        embedUrl: null,
                        playerUrl: null,
                        thumbnailUrl: null,
                        duration: 0,
                        isProcessing: false
                    };
                    break;
                case 'quiz':
                    newLecture.quiz = {
                        isGraded: req.body.graded || false,
                        questions: []
                    };
                    break;
                case 'note':
                    newLecture.note = {
                        content: req.body.content || ''
                    };
                    break;
            }

            section.lectures.push(newLecture);
            await course.save();

            res.status(201).json({
                message: 'Lecture added successfully',
                lecture: section.lectures[section.lectures.length - 1]
            });
        } catch (error) {
            console.error('Add lecture error:', error);
            res.status(500).json({ message: 'Failed to add lecture' });
        }
    }
);

// Update lecture content
router.put('/:courseId/sections/:sectionId/lectures/:lectureId',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const { courseId, sectionId, lectureId } = req.params;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            const section = course.sections.id(sectionId);
            if (!section) {
                return res.status(404).json({ message: 'Section not found' });
            }

            const lecture = section.lectures.id(lectureId);
            if (!lecture) {
                return res.status(404).json({ message: 'Lecture not found' });
            }

            // Update based on lecture type
            switch (lecture.type) {
                case 'video':
                    if (req.body.video) {
                        Object.assign(lecture.video, req.body.video);
                    }
                    break;
                case 'quiz':
                    if (req.body.quiz) {
                        Object.assign(lecture.quiz, req.body.quiz);
                    }
                    break;
                case 'note':
                    if (req.body.note) {
                        Object.assign(lecture.note, req.body.note);
                    }
                    break;
            }

            // Update common fields
            ['title', 'duration', 'description'].forEach(field => {
                if (req.body[field] !== undefined) {
                    lecture[field] = req.body[field];
                }
            });

            await course.save();

            res.json({
                message: 'Lecture updated successfully',
                lecture
            });
        } catch (error) {
            console.error('Update lecture error:', error);
            res.status(500).json({ message: 'Failed to update lecture' });
        }
    }
);

// Publish/Unpublish course
router.patch('/:courseId/publish',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const { courseId } = req.params;
            const { publish } = req.body; // true to publish, false to unpublish
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }

            // Validation for publishing
            if (publish) {
                // Check if basic info is complete
                if (!course.title || !course.description || !course.category || !course.whatYouWillLearn?.length) {
                    return res.status(400).json({ 
                        message: 'Course must have complete basic information before publishing' 
                    });
                }

                course.status = 'published';
                course.isPublished = true;
                course.publishedAt = new Date();
            } else {
                course.status = 'draft';
                course.isPublished = false;
                course.publishedAt = undefined;
            }

            await course.save();

            res.json({
                message: `Course ${publish ? 'published' : 'unpublished'} successfully`,
                course: {
                    _id: course._id,
                    title: course.title,
                    status: course.status,
                    isPublished: course.isPublished,
                    publishedAt: course.publishedAt
                }
            });
        } catch (error) {
            console.error('Publish/unpublish course error:', error);
            res.status(500).json({ message: 'Failed to update course status' });
        }
    }
);

// Get course details (for editing)
router.get('/:courseId',
    authenticateToken,
    async (req, res) => {
        try {
            const { courseId } = req.params;
            
            const course = await Course.findById(courseId)
                .populate('category', 'name')
                .populate('instructor', 'name email profile');

            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check if user can access this course
            const canAccess = course.instructor._id.toString() === req.user._id.toString() || 
                           req.user.role === 'admin' || 
                           course.isPublished;

            if (!canAccess) {
                return res.status(403).json({ message: 'Access denied' });
            }

            // Transform quiz data from backend format to frontend format
            if (course.sections && course.sections.length > 0) {
                course.sections = course.sections.map(section => {
                    if (section.lectures && section.lectures.length > 0) {
                        section.lectures = section.lectures.map(lecture => {
                            if (lecture.type === 'quiz' && lecture.quiz) {
                                // Convert backend quiz format to frontend format
                                lecture.questions = lecture.quiz.questions.map(q => ({
                                    text: q.question,
                                    type: q.type === 'single' ? 'single-choice' : 'multiple-choice',
                                    options: q.options.map((optText, idx) => ({
                                        text: optText,
                                        isCorrect: q.correctAnswers.includes(idx)
                                    }))
                                }));
                                
                                lecture.graded = lecture.quiz.isGraded;
                                lecture.passingScore = lecture.quiz.passingScore;
                                
                                // Remove backend quiz object to avoid duplication
                                delete lecture.quiz;
                            }

                            if (lecture.type === 'note' && lecture.note) {
                                // Convert backend note format to frontend format
                                lecture.content = lecture.note.content || '';
                                lecture.attachments = lecture.note.attachments || [];
                                
                                // Remove backend note object to avoid duplication
                                delete lecture.note;
                            }
                            return lecture;
                        });
                    }
                    return section;
                });
            }

            res.json({ course });
        } catch (error) {
            console.error('Get course error:', error);
            res.status(500).json({ message: 'Failed to fetch course' });
        }
    }
);

// Delete course
router.delete('/:courseId',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const { courseId } = req.params;
            
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check ownership
            if (course.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
                return res.status(403).json({ message: 'Access denied' });
            }

            // Don't allow deletion if course has enrollments
            const enrollmentCount = await Enrollment.countDocuments({ course: courseId });
            if (enrollmentCount > 0) {
                return res.status(400).json({ 
                    message: 'Cannot delete course with active enrollments' 
                });
            }

            await Course.findByIdAndDelete(courseId);

            res.json({ message: 'Course deleted successfully' });
        } catch (error) {
            console.error('Delete course error:', error);
            res.status(500).json({ message: 'Failed to delete course' });
        }
    }
);

// Test api.video connection
router.get('/test-apivideo',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const VideoService = require('../services/VideoService');
            const videoService = new VideoService();

            // Test creating a video (doesn't upload, just creates entry)
            const result = await videoService.createVideo({
                title: 'Test Video - ' + new Date().toISOString(),
                description: 'Test video created to verify api.video integration',
                isPublic: false,
                tags: ['test'],
                metadata: [
                    { key: 'test', value: 'true' },
                    { key: 'userId', value: req.user._id }
                ]
            });

            if (result.success) {
                res.json({
                    message: 'api.video connection successful',
                    testVideo: result.video
                });
            } else {
                res.status(400).json({
                    message: 'api.video connection failed',
                    error: result.error
                });
            }
        } catch (error) {
            console.error('api.video test error:', error);
            res.status(500).json({
                message: 'api.video test failed',
                error: error.message
            });
        }
    }
);

// Simple video upload to api.video
const videoUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB limit for lecture videos
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video' && file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else if (file.fieldname === 'thumbnail' && file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

router.post('/upload-video', 
    authenticateToken,
    requireVerifiedInstructor,
    videoUpload.fields([
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { courseId, sectionIndex, lectureIndex } = req.body;
            const videoFile = req.files.video?.[0];
            const thumbnailFile = req.files.thumbnail?.[0];

            console.log('📹 Simple video upload request:', {
                courseId,
                sectionIndex: parseInt(sectionIndex),
                lectureIndex: parseInt(lectureIndex),
                hasVideo: !!videoFile,
                hasThumbnail: !!thumbnailFile,
                videoSize: videoFile?.size,
                videoType: videoFile?.mimetype
            });

            if (!videoFile) {
                return res.status(400).json({ message: 'Video file is required' });
            }

            if (!courseId || sectionIndex === undefined || lectureIndex === undefined) {
                return res.status(400).json({ 
                    message: 'courseId, sectionIndex, and lectureIndex are required' 
                });
            }

            // Find the course
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Verify instructor ownership
            if (course.instructor.toString() !== req.user.id) {
                return res.status(403).json({ message: 'Not authorized to update this course' });
            }

            const sectionIdx = parseInt(sectionIndex);
            const lectureIdx = parseInt(lectureIndex);

            // Find the section and lecture
            const section = course.sections?.[sectionIdx];
            const lecture = section?.lectures?.[lectureIdx];

            if (!section || !lecture) {
                return res.status(404).json({ 
                    message: `Section ${sectionIdx} or lecture ${lectureIdx} not found` 
                });
            }

            console.log('📹 Found target lecture:', {
                sectionTitle: section.title,
                lectureTitle: lecture.title,
                lectureType: lecture.type
            });

            // Check if lecture already has a video
            const existingVideoId = lecture.video?.apiVideoId;
            
            const VideoService = require('../services/VideoService');
            const videoService = new VideoService();
            
            let videoResult;
            let uploadResult;
            
            if (existingVideoId) {
                console.log('📹 Updating existing video:', existingVideoId);
                
                // Update existing video metadata
                const updateResult = await videoService.updateVideo(existingVideoId, {
                    title: `${course.title} - ${section.title} - ${lecture.title}`,
                    description: lecture.description || `Lecture video for ${course.title}`
                });
                
                if (!updateResult.success) {
                    console.warn('Failed to update video metadata, but continuing with upload:', updateResult.error);
                }
                
                // Upload new video file to existing video ID
                uploadResult = await videoService.uploadVideo(
                    existingVideoId, 
                    videoFile.buffer,
                    videoFile.originalname
                );
                
                console.log('📹 Video file updated successfully:', uploadResult);
                
                // Get updated video info
                const getVideoResult = await videoService.getVideo(existingVideoId);
                if (getVideoResult.success) {
                    videoResult = { 
                        success: true, 
                        video: { 
                            videoId: existingVideoId, 
                            ...getVideoResult.video 
                        } 
                    };
                } else {
                    // Fallback: create video result with existing ID
                    videoResult = {
                        success: true,
                        video: {
                            videoId: existingVideoId,
                            embedUrl: `https://embed.api.video/vod/${existingVideoId}`,
                            playerUrl: `https://embed.api.video/vod/${existingVideoId}`,
                            hlsUrl: `https://cdn.api.video/vod/${existingVideoId}/hls/manifest.m3u8`,
                            mp4Url: `https://cdn.api.video/vod/${existingVideoId}/mp4/source.mp4`,
                            thumbnailUrl: `https://cdn.api.video/vod/${existingVideoId}/thumbnail.jpg`
                        }
                    };
                }
            } else {
                console.log('📹 Creating new video...');
                
                // Create new video
                videoResult = await videoService.createVideo({
                    title: `${course.title} - ${section.title} - ${lecture.title}`,
                    description: lecture.description || `Lecture video for ${course.title}`
                });

                if (!videoResult.success) {
                    throw new Error(`Failed to create video: ${videoResult.error}`);
                }

                console.log('📹 Created new api.video entry:', videoResult.video.videoId);

                // Upload the video file
                uploadResult = await videoService.uploadVideo(
                    videoResult.video.videoId, 
                    videoFile.buffer,
                    videoFile.originalname
                );

                console.log('📹 Video uploaded successfully:', uploadResult);
            }

            // Upload thumbnail if provided
            let thumbnailResult = null;
            if (thumbnailFile) {
                console.log('📹 Uploading thumbnail...');
                thumbnailResult = await videoService.uploadThumbnail(
                    videoResult.video.videoId,
                    thumbnailFile.buffer,
                    thumbnailFile.originalname
                );
                console.log('📹 Thumbnail uploaded:', thumbnailResult);
                
                // Update video result with new thumbnail URL
                if (thumbnailResult.success && thumbnailResult.video.thumbnailUrl) {
                    videoResult.video.thumbnailUrl = thumbnailResult.video.thumbnailUrl;
                }
            }

            // Update the lecture with api.video data
            const videoData = {
                apiVideoId: videoResult.video.videoId,
                embedUrl: videoResult.video.embedUrl,
                playerUrl: videoResult.video.playerUrl,
                thumbnailUrl: thumbnailResult?.thumbnailUrl || videoResult.video.thumbnailUrl,
                hlsUrl: videoResult.video.hlsUrl,
                mp4Url: videoResult.video.mp4Url,
                duration: videoResult.video.duration || 0
            };

            // Update the specific lecture
            course.sections[sectionIdx].lectures[lectureIdx].video = {
                ...course.sections[sectionIdx].lectures[lectureIdx].video,
                ...videoData
            };

            await course.save();

            console.log('📹 Course updated with video data');

            res.json({
                message: 'Video uploaded successfully',
                videoData,
                lecture: course.sections[sectionIdx].lectures[lectureIdx]
            });

        } catch (error) {
            console.error('Video upload error:', error);
            res.status(500).json({
                message: 'Failed to upload video',
                error: error.message
            });
        }
    }
);

module.exports = router;
