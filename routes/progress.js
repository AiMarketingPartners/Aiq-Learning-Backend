const express = require('express');
const { body } = require('express-validator');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const User = require('../models/User');
const Certificate = require('../models/Certificate');
const { authenticateToken } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Mark lesson as completed
router.post('/lesson-complete', authenticateToken, [
    body('courseId').isMongoId().withMessage('Valid course ID required'),
    body('sectionId').optional().isMongoId().withMessage('Valid section ID required'),
    body('lectureId').optional().isMongoId().withMessage('Valid lecture ID required'),
    body('sectionIndex').optional().isNumeric().withMessage('Valid section index required'),
    body('lessonIndex').optional().isNumeric().withMessage('Valid lesson index required'),
    body('timeSpent').optional().isNumeric().withMessage('Time spent must be a number'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { courseId, sectionId, lectureId, sectionIndex: providedSectionIndex, lessonIndex: providedLessonIndex, timeSpent } = req.body;

        // Find enrollment
        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId,
            isActive: true
        }).populate('course');

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Determine sectionIndex and lessonIndex
        let sectionIndex = providedSectionIndex;
        let lessonIndex = providedLessonIndex;

        // If IDs are provided instead of indices, find the indices
        if ((sectionId || lectureId) && enrollment.course.sections) {
            for (let sIdx = 0; sIdx < enrollment.course.sections.length; sIdx++) {
                const section = enrollment.course.sections[sIdx];
                
                // If we have sectionId, check if this is the right section
                if (sectionId && section._id.toString() === sectionId) {
                    sectionIndex = sIdx;
                }
                
                // If we have lectureId, find the lecture within sections
                if (lectureId && section.lectures) {
                    for (let lIdx = 0; lIdx < section.lectures.length; lIdx++) {
                        const lecture = section.lectures[lIdx];
                        if (lecture._id.toString() === lectureId) {
                            sectionIndex = sIdx;
                            lessonIndex = lIdx;
                            break;
                        }
                    }
                }
            }
        }

        // Validate that we have valid indices
        if (sectionIndex === undefined || lessonIndex === undefined) {
            return res.status(400).json({ message: 'Could not determine section and lesson indices' });
        }

        // Check if lesson already completed
        const existingCompletion = enrollment.progress.completedLessons.find(
            lesson => lesson.sectionIndex === sectionIndex && lesson.lessonIndex === lessonIndex
        );

        if (!existingCompletion) {
            enrollment.progress.completedLessons.push({
                sectionIndex,
                lessonIndex,
                completedAt: new Date()
            });
        }

        // Update last accessed lesson
        enrollment.progress.lastAccessedLesson = {
            sectionIndex,
            lessonIndex
        };

        // Add time spent
        if (timeSpent) {
            enrollment.progress.totalTimeSpent += timeSpent;
        }

        // Calculate progress
        await enrollment.calculateProgress();
        await enrollment.save();

        // Check if course is completed and generate certificate
        if (enrollment.progress.overallProgress === 100 && enrollment.completedAt) {
            // Check if certificate already exists
            let certificate = await Certificate.findOne({
                user: req.user._id,
                course: courseId
            });

            if (!certificate) {
                const course = await Course.findById(courseId);
                
                certificate = new Certificate({
                    user: req.user._id,
                    course: courseId,
                    completedAt: enrollment.completedAt,
                    metadata: {
                        totalDuration: course.totalDuration,
                        completionTime: Math.ceil((enrollment.completedAt - enrollment.enrolledAt) / (1000 * 60 * 60 * 24)),
                        finalScore: 100 // Can be enhanced with quiz scores
                    }
                });

                await certificate.save();

                // Update user's completed courses
                await User.findByIdAndUpdate(req.user._id, {
                    $addToSet: { 
                        'learner.completedCourses': courseId,
                        'learner.certificates': certificate._id
                    }
                });
            }
        }

        res.json({
            message: 'Lesson marked as completed',
            progress: enrollment.progress
        });
    } catch (error) {
        console.error('Mark lesson complete error:', error);
        res.status(500).json({ message: 'Failed to mark lesson as completed' });
    }
});

// Unmark lesson as completed
router.post('/lesson-uncomplete', authenticateToken, [
    body('courseId').isMongoId().withMessage('Valid course ID required'),
    body('sectionId').optional().isMongoId().withMessage('Valid section ID required'),
    body('lectureId').optional().isMongoId().withMessage('Valid lecture ID required'),
    body('sectionIndex').optional().isNumeric().withMessage('Valid section index required'),
    body('lessonIndex').optional().isNumeric().withMessage('Valid lesson index required'),
    body('timeSpent').optional().isNumeric().withMessage('Time spent must be a number'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { courseId, sectionId, lectureId, sectionIndex: providedSectionIndex, lessonIndex: providedLessonIndex, timeSpent } = req.body;

        // Find enrollment
        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId,
            isActive: true
        }).populate('course');

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Determine sectionIndex and lessonIndex
        let sectionIndex = providedSectionIndex;
        let lessonIndex = providedLessonIndex;

        // If IDs are provided instead of indices, find the indices
        if ((sectionId || lectureId) && enrollment.course.sections) {
            for (let sIdx = 0; sIdx < enrollment.course.sections.length; sIdx++) {
                const section = enrollment.course.sections[sIdx];
                
                if (sectionId && section._id.toString() === sectionId) {
                    sectionIndex = sIdx;
                }
                
                if (lectureId && section.lectures) {
                    for (let lIdx = 0; lIdx < section.lectures.length; lIdx++) {
                        const lecture = section.lectures[lIdx];
                        if (lecture._id.toString() === lectureId) {
                            sectionIndex = sIdx;
                            lessonIndex = lIdx;
                            break;
                        }
                    }
                }
            }
        }

        // Validate that we have valid indices
        if (sectionIndex === undefined || lessonIndex === undefined) {
            return res.status(400).json({ message: 'Could not determine section and lesson indices' });
        }

        // Remove lesson from completed lessons
        enrollment.progress.completedLessons = enrollment.progress.completedLessons.filter(
            lesson => !(lesson.sectionIndex === sectionIndex && lesson.lessonIndex === lessonIndex)
        );

        // Subtract time spent if provided
        if (timeSpent && enrollment.progress.totalTimeSpent >= timeSpent) {
            enrollment.progress.totalTimeSpent -= timeSpent;
        }

        // Recalculate progress
        await enrollment.calculateProgress();
        await enrollment.save();

        // If course was completed, mark as incomplete
        if (enrollment.completedAt) {
            enrollment.completedAt = undefined;
            await enrollment.save();
        }

        res.json({
            message: 'Lesson unmarked as completed',
            progress: enrollment.progress
        });
    } catch (error) {
        console.error('Unmark lesson complete error:', error);
        res.status(500).json({ message: 'Failed to unmark lesson as completed' });
    }
});

// Get user progress for a course
router.get('/course/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;

        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId,
            isActive: true
        }).populate('course', 'title sections totalLessons totalDuration');

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Get detailed progress information
        const course = enrollment.course;
        const progressDetails = {
            overallProgress: enrollment.progress.overallProgress,
            completedLessons: enrollment.progress.completedLessons, // Return the actual array
            completedLessonsCount: enrollment.progress.completedLessons.length, // Also provide count
            totalLessons: course.totalLessons,
            totalTimeSpent: enrollment.progress.totalTimeSpent,
            lastAccessedLesson: enrollment.progress.lastAccessedLesson,
            sectionProgress: []
        };

        // Calculate progress per section
        course.sections.forEach((section, sectionIndex) => {
            const sectionLessons = section.lectures ? section.lectures.length : 0;
            const completedInSection = enrollment.progress.completedLessons.filter(
                lesson => lesson.sectionIndex === sectionIndex
            ).length;

            progressDetails.sectionProgress.push({
                sectionIndex,
                sectionTitle: section.title,
                totalLessons: sectionLessons,
                completedLessons: completedInSection,
                progress: sectionLessons > 0 ? Math.round((completedInSection / sectionLessons) * 100) : 0
            });
        });

        res.json({
            enrollment: {
                _id: enrollment._id,
                enrolledAt: enrollment.enrolledAt,
                completedAt: enrollment.completedAt,
                isActive: enrollment.isActive
            },
            progress: progressDetails
        });
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({ message: 'Failed to fetch progress' });
    }
});

// Get user's overall learning progress
router.get('/overview', authenticateToken, async (req, res) => {
    try {
        const enrollments = await Enrollment.find({
            user: req.user._id,
            isActive: true
        }).populate('course', 'title thumbnail category level totalDuration');

        const totalEnrollments = enrollments.length;
        const completedCourses = enrollments.filter(e => e.completedAt).length;
        
        // Safely calculate progress and time spent with fallbacks
        const averageProgress = totalEnrollments > 0 
            ? enrollments.reduce((sum, e) => {
                const progress = e.progress?.overallProgress || 0;
                return sum + progress;
            }, 0) / totalEnrollments 
            : 0;
            
        const totalTimeSpent = enrollments.reduce((sum, e) => {
            const timeSpent = e.progress?.totalTimeSpent || 0;
            return sum + timeSpent;
        }, 0);
        
        // Get certificates
        const certificates = await Certificate.find({ user: req.user._id })
            .populate('course', 'title thumbnail')
            .sort({ issuedAt: -1 });
            
        console.log('📊 Dashboard overview calculation:', {
            userId: req.user._id,
            totalEnrollments,
            completedCourses,
            averageProgress,
            totalTimeSpent,
            certificatesCount: certificates.length
        });

        res.json({
            overview: {
                totalEnrolled: totalEnrollments,
                totalCompleted: completedCourses,
                totalCertificates: certificates.length,
                totalWatchTime: totalTimeSpent, // Keep in seconds, frontend converts to hours
                overallProgress: Math.round(averageProgress)
            },
            recentEnrollments: enrollments.slice(0, 5),
            certificates: certificates.slice(0, 5)
        });
    } catch (error) {
        console.error('Get progress overview error:', error);
        res.status(500).json({ message: 'Failed to fetch progress overview' });
    }
});

// Update lesson access time
router.put('/lesson-access', authenticateToken, [
    body('courseId').isMongoId().withMessage('Valid course ID required'),
    body('sectionIndex').isNumeric().withMessage('Valid section index required'),
    body('lessonIndex').isNumeric().withMessage('Valid lesson index required'),
    body('timeSpent').optional().isNumeric().withMessage('Time spent must be a number'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { courseId, sectionIndex, lessonIndex, timeSpent } = req.body;

        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId,
            isActive: true
        });

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Update last accessed lesson
        enrollment.progress.lastAccessedLesson = {
            sectionIndex,
            lessonIndex
        };

        // Add time spent if provided
        if (timeSpent) {
            enrollment.progress.totalTimeSpent += timeSpent;
        }

        await enrollment.save();

        res.json({
            message: 'Lesson access updated',
            lastAccessedLesson: enrollment.progress.lastAccessedLesson,
            totalTimeSpent: enrollment.progress.totalTimeSpent
        });
    } catch (error) {
        console.error('Update lesson access error:', error);
        res.status(500).json({ message: 'Failed to update lesson access' });
    }
});

// Reset course progress (for testing or retake)
router.post('/reset/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;

        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: courseId,
            isActive: true
        });

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Reset progress
        enrollment.progress.completedLessons = [];
        enrollment.progress.overallProgress = 0;
        enrollment.progress.lastAccessedLesson = undefined;
        enrollment.progress.totalTimeSpent = 0;
        enrollment.completedAt = undefined;

        await enrollment.save();

        // Remove from completed courses
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { 'learner.completedCourses': courseId }
        });

        res.json({
            message: 'Course progress reset successfully',
            progress: enrollment.progress
        });
    } catch (error) {
        console.error('Reset progress error:', error);
        res.status(500).json({ message: 'Failed to reset course progress' });
    }
});

module.exports = router;