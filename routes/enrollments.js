const express = require('express');
const { body } = require('express-validator');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const User = require('../models/User');
const Certificate = require('../models/Certificate');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Enroll in course
router.post('/enroll/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;

        // Check if course exists and is published
        const course = await Course.findById(courseId);
        if (!course || !course.isPublished) {
            return res.status(404).json({ message: 'Course not found or not published' });
        }

        // Check if already enrolled
        const existingEnrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId
        });

        if (existingEnrollment) {
            if (existingEnrollment.isActive) {
                return res.status(400).json({ message: 'Already enrolled in this course' });
            } else {
                // Reactivate enrollment
                existingEnrollment.isActive = true;
                existingEnrollment.enrolledAt = new Date();
                await existingEnrollment.save();
                
                return res.json({
                    message: 'Course enrollment reactivated',
                    enrollment: existingEnrollment
                });
            }
        }

        // Create new enrollment
        const enrollment = new Enrollment({
            user: req.user._id,
            course: courseId
        });

        await enrollment.save();

        // Update course enrolled students count
        await Course.findByIdAndUpdate(courseId, {
            $inc: { enrolledStudents: 1 }
        });

        // Update user enrolled courses
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { 'learner.enrolledCourses': courseId }
        });

        await enrollment.populate('course', 'title thumbnail instructor');

        res.status(201).json({
            message: 'Successfully enrolled in course',
            enrollment
        });
    } catch (error) {
        console.error('Enrollment error:', error);
        res.status(500).json({ message: 'Failed to enroll in course' });
    }
});

// Get user's enrollments
router.get('/my-enrollments', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const skip = (page - 1) * limit;

        const filter = { user: req.user._id, isActive: true };
        
        if (status === 'completed') {
            filter.completedAt = { $exists: true };
        } else if (status === 'in-progress') {
            filter.completedAt = { $exists: false };
        }

        const enrollments = await Enrollment.find(filter)
            .populate('course', 'title thumbnail instructor level totalDuration totalLessons rating')
            .populate({
                path: 'course',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ enrolledAt: -1 });

        const total = await Enrollment.countDocuments(filter);

        res.json({
            enrollments,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            totalEnrollments: total
        });
    } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ message: 'Failed to fetch enrollments' });
    }
});

// Get student's enrolled courses with detailed progress (for dashboard)
router.get('/my-courses', authenticateToken, requireRole(['learner']), async (req, res) => {
    try {
        const { status = 'all', page = 1, limit = 12 } = req.query;
        const skip = (page - 1) * limit;

        const filter = { user: req.user._id, isActive: true };
        
        if (status === 'completed') {
            filter.completedAt = { $exists: true };
        } else if (status === 'in_progress') {
            filter.completedAt = { $exists: false };
        }

        const enrollments = await Enrollment.find(filter)
            .populate({
                path: 'course',
                select: 'title thumbnail instructor category level rating sections totalDuration',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ enrolledAt: -1 });

        // Get progress for each enrollment
        const Progress = require('../models/Progress');
        const coursesWithProgress = await Promise.all(
            enrollments.map(async (enrollment) => {
                const progress = await Progress.findOne({
                    user: req.user._id,
                    course: enrollment.course._id
                });

                const totalLectures = enrollment.course.sections.reduce((total, section) => 
                    total + section.lectures.length, 0
                );

                const completedLectures = progress ? progress.completedLectures.length : 0;
                const completionPercentage = totalLectures > 0 ? Math.round((completedLectures / totalLectures) * 100) : 0;

                // Calculate time spent (you might want to track this more accurately)
                const timeSpent = progress ? progress.timeSpent || 0 : 0;
                const timeSpentFormatted = Math.floor(timeSpent / 3600) + 'h ' + Math.floor((timeSpent % 3600) / 60) + 'm';

                // Get current lecture info
                let currentLecture = null;
                if (progress && progress.currentLecture) {
                    currentLecture = progress.currentLecture;
                }

                return {
                    _id: enrollment._id,
                    course: enrollment.course,
                    progress: {
                        completionPercentage,
                        currentLecture: currentLecture || 'Not started',
                        totalLectures,
                        completedLectures
                    },
                    enrolledAt: enrollment.enrolledAt,
                    lastAccessed: enrollment.lastAccessed || enrollment.enrolledAt,
                    timeSpent: timeSpentFormatted
                };
            })
        );

        const total = await Enrollment.countDocuments(filter);

        res.json({
            courses: coursesWithProgress,
            pagination: {
                current: parseInt(page),
                total: Math.ceil(total / limit),
                count: coursesWithProgress.length,
                totalCourses: total
            }
        });
    } catch (error) {
        console.error('Get student courses error:', error);
        res.status(500).json({ message: 'Failed to fetch student courses' });
    }
});

// Get enrollment details
router.get('/:enrollmentId', authenticateToken, async (req, res) => {
    try {
        const { enrollmentId } = req.params;

        const enrollment = await Enrollment.findById(enrollmentId)
            .populate('user', 'name email profile.avatar')
            .populate('course');

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Check access permissions
        if (enrollment.user._id.toString() !== req.user._id.toString() && 
            req.user.role !== 'admin' && 
            enrollment.course.instructor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json({ enrollment });
    } catch (error) {
        console.error('Get enrollment error:', error);
        res.status(500).json({ message: 'Failed to fetch enrollment' });
    }
});

// Get learner's enrollment status for a specific course
router.get('/my-enrollment/:courseId', authenticateToken, requireRole('learner'), async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user._id;

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Find enrollment
        const enrollment = await Enrollment.findOne({
            user: userId,
            course: courseId,
            isActive: true
        }).populate({
            path: 'course',
            select: 'title description poster duration sections instructor category',
            populate: [
                {
                    path: 'instructor',
                    select: 'name profileImage'
                },
                {
                    path: 'category',
                    select: 'name'
                }
            ]
        });

        if (!enrollment) {
            return res.json({ 
                isEnrolled: false,
                enrollment: null
            });
        }

        res.json({
            isEnrolled: true,
            enrollment: enrollment
        });
    } catch (error) {
        console.error('Get learner enrollment error:', error);
        res.status(500).json({ message: 'Failed to fetch enrollment status' });
    }
});

// Get course enrollments (instructor/admin only)
router.get('/course/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        // Check permissions
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (course.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const enrollments = await Enrollment.find({ 
            course: courseId, 
            isActive: true 
        })
            .populate('user', 'name email profile.avatar')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ enrolledAt: -1 });

        const total = await Enrollment.countDocuments({ 
            course: courseId, 
            isActive: true 
        });

        res.json({
            enrollments,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            totalEnrollments: total
        });
    } catch (error) {
        console.error('Get course enrollments error:', error);
        res.status(500).json({ message: 'Failed to fetch course enrollments' });
    }
});

// Unenroll from course
router.delete('/:enrollmentId', authenticateToken, async (req, res) => {
    try {
        const { enrollmentId } = req.params;

        const enrollment = await Enrollment.findById(enrollmentId);
        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Check ownership
        if (enrollment.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        enrollment.isActive = false;
        await enrollment.save();

        // Update course enrolled students count
        await Course.findByIdAndUpdate(enrollment.course, {
            $inc: { enrolledStudents: -1 }
        });

        // Remove from user's enrolled courses
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { 'learner.enrolledCourses': enrollment.course }
        });

        res.json({ message: 'Successfully unenrolled from course' });
    } catch (error) {
        console.error('Unenroll error:', error);
        res.status(500).json({ message: 'Failed to unenroll from course' });
    }
});

// Get enrollment statistics (instructor/admin)
router.get('/stats/overview', authenticateToken, requireRole(['instructor', 'admin']), async (req, res) => {
    try {
        let matchStage = {};
        
        // If instructor, only show their courses
        if (req.user.role === 'instructor') {
            const instructorCourses = await Course.find({ 
                instructor: req.user._id 
            }).select('_id');
            
            matchStage = { 
                course: { $in: instructorCourses.map(c => c._id) },
                isActive: true
            };
        } else {
            matchStage = { isActive: true };
        }

        const stats = await Enrollment.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalEnrollments: { $sum: 1 },
                    completedEnrollments: {
                        $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] }
                    },
                    averageProgress: { $avg: '$progress.overallProgress' }
                }
            }
        ]);

        const result = stats[0] || {
            totalEnrollments: 0,
            completedEnrollments: 0,
            averageProgress: 0
        };

        res.json(result);
    } catch (error) {
        console.error('Get enrollment stats error:', error);
        res.status(500).json({ message: 'Failed to fetch enrollment statistics' });
    }
});



module.exports = router;