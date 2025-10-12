const express = require('express');
const Certificate = require('../models/Certificate');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const { authenticateToken, requireRole } = require('../middleware/auth');
const CertificateService = require('../services/CertificateService');

const router = express.Router();
const certificateService = new CertificateService();

// Get user's certificates
router.get('/', authenticateToken, async (req, res) => {
    try {
        const certificates = await Certificate.find({ user: req.user._id })
            .populate('course', 'title thumbnail instructor category')
            .populate({
                path: 'course',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            })
            .sort({ issuedAt: -1 });

        res.json({
            success: true,
            certificates
        });
    } catch (error) {
        console.error('Get certificates error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch certificates' });
    }
});

// Get user's certificates with pagination
router.get('/my-certificates', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const certificates = await Certificate.find({ user: req.user._id })
            .populate('course', 'title thumbnail instructor category')
            .populate({
                path: 'course',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            })
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ issuedAt: -1 });

        const total = await Certificate.countDocuments({ user: req.user._id });

        res.json({
            certificates,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            totalCertificates: total
        });
    } catch (error) {
        console.error('Get certificates error:', error);
        res.status(500).json({ message: 'Failed to fetch certificates' });
    }
});

// Get certificate by ID
router.get('/:certificateId', authenticateToken, async (req, res) => {
    try {
        const { certificateId } = req.params;

        const certificate = await Certificate.findById(certificateId)
            .populate('user', 'name email profile.avatar')
            .populate('course', 'title description instructor category level totalDuration')
            .populate({
                path: 'course',
                populate: [
                    { path: 'instructor', select: 'name profile.avatar' },
                    { path: 'category', select: 'name' }
                ]
            });

        if (!certificate) {
            return res.status(404).json({ message: 'Certificate not found' });
        }

        // Check access permissions
        if (certificate.user._id.toString() !== req.user._id.toString() && 
            req.user.role !== 'admin' && 
            certificate.course.instructor._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json({ certificate });
    } catch (error) {
        console.error('Get certificate error:', error);
        res.status(500).json({ message: 'Failed to fetch certificate' });
    }
});

// Verify certificate by certificate ID (public)
router.get('/verify/:certificateId', async (req, res) => {
    try {
        const { certificateId } = req.params;

        const certificate = await Certificate.findOne({ certificateId })
            .populate('user', 'name')
            .populate('course', 'title instructor category level')
            .populate({
                path: 'course',
                populate: [
                    { path: 'instructor', select: 'name' },
                    { path: 'category', select: 'name' }
                ]
            });

        if (!certificate) {
            return res.status(404).json({ 
                message: 'Certificate not found',
                isValid: false
            });
        }

        res.json({
            message: 'Certificate is valid',
            isValid: true,
            certificate: {
                certificateId: certificate.certificateId,
                user: certificate.user.name,
                course: certificate.course.title,
                instructor: certificate.course.instructor.name,
                category: certificate.course.category.name,
                level: certificate.course.level,
                issuedAt: certificate.issuedAt,
                completedAt: certificate.completedAt,
                grade: certificate.grade
            }
        });
    } catch (error) {
        console.error('Verify certificate error:', error);
        res.status(500).json({ message: 'Failed to verify certificate' });
    }
});

// Generate certificate (manual - for admin/instructor)
router.post('/generate', authenticateToken, requireRole(['admin', 'instructor']), async (req, res) => {
    try {
        const { userId, courseId, grade, skills } = req.body;

        // Check if enrollment exists and is completed
        const enrollment = await Enrollment.findOne({
            user: userId,
            course: courseId,
            completedAt: { $exists: true }
        });

        if (!enrollment) {
            return res.status(400).json({ 
                message: 'User has not completed this course' 
            });
        }

        // Check if instructor owns the course
        if (req.user.role === 'instructor') {
            const course = await Course.findById(courseId);
            if (!course || course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }
        }

        // Check if certificate already exists
        const existingCertificate = await Certificate.findOne({
            user: userId,
            course: courseId
        });

        if (existingCertificate) {
            return res.status(400).json({ 
                message: 'Certificate already exists for this user and course' 
            });
        }

        const course = await Course.findById(courseId);
        
        const certificate = new Certificate({
            user: userId,
            course: courseId,
            completedAt: enrollment.completedAt,
            grade: grade || 'Pass',
            skills: skills || [],
            metadata: {
                totalDuration: course.totalDuration,
                completionTime: Math.ceil((enrollment.completedAt - enrollment.enrolledAt) / (1000 * 60 * 60 * 24)),
                finalScore: 100
            }
        });

        await certificate.save();
        await certificate.populate('course', 'title');
        await certificate.populate('user', 'name email');

        res.status(201).json({
            message: 'Certificate generated successfully',
            certificate
        });
    } catch (error) {
        console.error('Generate certificate error:', error);
        res.status(500).json({ message: 'Failed to generate certificate' });
    }
});

// Get learner's certificate for a specific course
router.get('/course/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;

        // Find certificate for this user and course
        const certificate = await Certificate.findOne({ 
            user: req.user._id, 
            course: courseId 
        })
        .populate('course', 'title instructor category')
        .populate('user', 'name email');

        if (!certificate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Certificate not found for this course' 
            });
        }

        res.json({
            success: true,
            certificate
        });
    } catch (error) {
        console.error('Get user course certificate error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch certificate' 
        });
    }
});

// Get all course certificates (instructor/admin only)
router.get('/course/:courseId/all', authenticateToken, requireRole(['instructor', 'admin']), async (req, res) => {
    try {
        const { courseId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        // Check if instructor owns the course
        if (req.user.role === 'instructor') {
            const course = await Course.findById(courseId);
            if (!course || course.instructor.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Access denied' });
            }
        }

        const certificates = await Certificate.find({ course: courseId })
            .populate('user', 'name email profile.avatar')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ issuedAt: -1 });

        const total = await Certificate.countDocuments({ course: courseId });

        res.json({
            certificates,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            totalCertificates: total
        });
    } catch (error) {
        console.error('Get course certificates error:', error);
        res.status(500).json({ message: 'Failed to fetch course certificates' });
    }
});

// Check certificate eligibility for a course
router.get('/check-eligibility/:courseId', authenticateToken, async (req, res) => {
    try {
        const result = await certificateService.checkEligibility(
            req.user._id, 
            req.params.courseId
        );

        res.json({
            success: true,
            eligible: result.eligible,
            reason: result.reason,
            data: result.data,
            existingCertificate: result.certificate
        });
    } catch (error) {
        console.error('Check eligibility error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error checking certificate eligibility'
        });
    }
});

// Generate certificate for completed course (simple version)
router.post('/generate/:courseId', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user._id;

        // Check if certificate already exists
        const existingCertificate = await Certificate.findOne({
            user: userId,
            course: courseId
        });

        if (existingCertificate) {
            return res.status(200).json({
                success: true,
                message: 'Certificate already exists',
                certificate: existingCertificate
            });
        }

        // Check if user has completed the course
        const enrollment = await Enrollment.findOne({
            user: userId,
            course: courseId,
            completedAt: { $exists: true }
        });

        if (!enrollment) {
            return res.status(400).json({
                success: false,
                message: 'Course not completed yet'
            });
        }

        // Get course details
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Generate certificate ID manually to ensure it's set
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        const certificateId = `CERT-${timestamp}-${random}`;

        // Create the certificate
        const certificate = new Certificate({
            user: userId,
            course: courseId,
            certificateId: certificateId, // Set explicitly
            completedAt: enrollment.completedAt,
            grade: 'Pass', // Use valid enum value
            skills: [],
            metadata: {
                totalDuration: course.totalDuration || 0,
                completionTime: Math.ceil((enrollment.completedAt - enrollment.enrolledAt) / (1000 * 60 * 60 * 24)),
                finalScore: 100
            }
        });

        await certificate.save();
        
        // Populate the certificate with course and user details
        await certificate.populate('course', 'title instructor category');
        await certificate.populate('user', 'name email');

        res.status(201).json({
            success: true,
            message: 'Certificate generated successfully',
            certificate
        });
    } catch (error) {
        console.error('Generate certificate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate certificate'
        });
    }
});

// Render certificate as HTML for viewing/printing
router.get('/render/:certificateId', authenticateToken, async (req, res) => {
    try {
        const certificate = await Certificate.findById(req.params.certificateId)
            .populate('user', 'name email')
            .populate('course', 'title category instructor');

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found'
            });
        }

        // Check access - owner or course instructor
        const isOwner = certificate.user._id.toString() === req.user._id.toString();
        const isInstructor = certificate.course.instructor.toString() === req.user._id.toString();

        if (!isOwner && !isInstructor && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const htmlContent = certificateService.generateCertificateHTML(certificate);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
    } catch (error) {
        console.error('Render certificate error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error rendering certificate'
        });
    }
});

// Verify certificate authenticity (public endpoint)
router.get('/verify/:certificateUuid', async (req, res) => {
    try {
        const result = await certificateService.verifyCertificate(req.params.certificateUuid);
        
        res.json({
            success: true,
            valid: result.valid,
            message: result.message,
            certificate: result.certificate
        });
    } catch (error) {
        console.error('Verify certificate error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error verifying certificate'
        });
    }
});

// Get certificate statistics
router.get('/stats/overview', authenticateToken, requireRole(['admin', 'instructor']), async (req, res) => {
    try {
        let matchStage = {};
        
        // If instructor, only show their courses
        if (req.user.role === 'instructor') {
            const instructorCourses = await Course.find({ 
                instructor: req.user._id 
            }).select('_id');
            
            matchStage = { 
                course: { $in: instructorCourses.map(c => c._id) }
            };
        }

        const stats = await Certificate.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalCertificates: { $sum: 1 },
                    thisMonth: {
                        $sum: {
                            $cond: [
                                {
                                    $gte: [
                                        '$issuedAt',
                                        new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const gradeStats = await Certificate.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$grade',
                    count: { $sum: 1 }
                }
            }
        ]);

        const result = stats[0] || {
            totalCertificates: 0,
            thisMonth: 0
        };

        result.gradeDistribution = gradeStats;

        res.json(result);
    } catch (error) {
        console.error('Get certificate stats error:', error);
        res.status(500).json({ message: 'Failed to fetch certificate statistics' });
    }
});

module.exports = router;