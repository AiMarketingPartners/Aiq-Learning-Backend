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
            const instructorId = req.user.userId;

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

// Get instructor's courses
router.get('/instructor/my-courses',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const instructorId = req.user.userId;
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
                instructor: req.user.userId,
                category,
                level: req.body.level || 'beginner',
                price: parseFloat(price),
                originalPrice: parseFloat(price),
                whatYouWillLearn: JSON.parse(whatYouWillLearn),
                requirements: requirements ? JSON.parse(requirements) : [],
                status: 'draft',
                isPublished: false
            };

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

            res.status(201).json({
                message: 'Course draft created successfully',
                course: {
                    _id: course._id,
                    title: course.title,
                    status: course.status,
                    createdAt: course.createdAt
                }
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
            if (course.instructor.toString() !== req.user.userId) {
                return res.status(403).json({ message: 'Access denied' });
            }

            // Update basic fields
            const allowedFields = ['title', 'description', 'category', 'price', 'whatYouWillLearn', 'requirements', 'level'];
            allowedFields.forEach(field => {
                if (req.body[field] !== undefined) {
                    if (field === 'whatYouWillLearn' || field === 'requirements') {
                        course[field] = JSON.parse(req.body[field]);
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
            if (course.instructor.toString() !== req.user.userId) {
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
            if (course.instructor.toString() !== req.user.userId) {
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
            if (course.instructor.toString() !== req.user.userId) {
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
            if (course.instructor.toString() !== req.user.userId) {
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
            const canAccess = course.instructor._id.toString() === req.user.userId || 
                           req.user.role === 'admin' || 
                           course.isPublished;

            if (!canAccess) {
                return res.status(403).json({ message: 'Access denied' });
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
            if (course.instructor.toString() !== req.user.userId && req.user.role !== 'admin') {
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

module.exports = router;