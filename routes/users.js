const express = require('express');
const { body } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { page = 1, limit = 10, role, status } = req.query;
        const skip = (page - 1) * limit;

        const filter = {};
        if (role) filter.role = role;
        if (status) {
            if (status === 'verified') filter.isVerified = true;
            if (status === 'unverified') filter.isVerified = false;
            if (status === 'active') filter.isActive = true;
            if (status === 'inactive') filter.isActive = false;
        }

        const users = await User.find(filter)
            .select('-password')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(filter);

        res.json({
            users,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            totalUsers: total
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
});

// Get pending instructor verifications
router.get('/pending-instructors', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const pendingInstructors = await User.find({
            role: 'instructor',
            'instructor.verificationStatus': 'pending'
        }).select('-password');

        res.json({
            pendingInstructors,
            count: pendingInstructors.length
        });
    } catch (error) {
        console.error('Get pending instructors error:', error);
        res.status(500).json({ message: 'Failed to fetch pending instructors' });
    }
});

// Verify/reject instructor
router.put('/verify-instructor/:userId', authenticateToken, requireRole(['admin']), [
    body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
    body('reason').optional().trim(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { userId } = req.params;
        const { action, reason } = req.body;

        const instructor = await User.findById(userId);
        if (!instructor) {
            return res.status(404).json({ message: 'Instructor not found' });
        }

        if (instructor.role !== 'instructor') {
            return res.status(400).json({ message: 'User is not an instructor' });
        }

        if (action === 'approve') {
            instructor.instructor.verificationStatus = 'approved';
            instructor.isVerified = true;
            instructor.instructor.verifiedAt = new Date();
            instructor.instructor.verifiedBy = req.user._id;
        } else {
            instructor.instructor.verificationStatus = 'rejected';
            instructor.isVerified = false;
        }

        await instructor.save();

        res.json({
            message: `Instructor ${action}d successfully`,
            instructor: instructor.getPublicProfile()
        });
    } catch (error) {
        console.error('Verify instructor error:', error);
        res.status(500).json({ message: 'Failed to verify instructor' });
    }
});

// Get user by ID
router.get('/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Allow users to view their own profile or admins to view any profile
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const user = await User.findById(userId).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'Failed to fetch user' });
    }
});

// Update user status (admin only)
router.put('/:userId/status', authenticateToken, requireRole(['admin']), [
    body('isActive').isBoolean().withMessage('isActive must be a boolean'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { userId } = req.params;
        const { isActive } = req.body;

        const user = await User.findByIdAndUpdate(
            userId,
            { isActive },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
            user
        });
    } catch (error) {
        console.error('Update user status error:', error);
        res.status(500).json({ message: 'Failed to update user status' });
    }
});

// Get instructor statistics
router.get('/instructors/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const stats = await User.aggregate([
            { $match: { role: 'instructor' } },
            {
                $group: {
                    _id: '$instructor.verificationStatus',
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalInstructors = await User.countDocuments({ role: 'instructor' });
        const verifiedInstructors = await User.countDocuments({ 
            role: 'instructor', 
            'instructor.verificationStatus': 'approved' 
        });

        res.json({
            totalInstructors,
            verifiedInstructors,
            verificationStats: stats
        });
    } catch (error) {
        console.error('Get instructor stats error:', error);
        res.status(500).json({ message: 'Failed to fetch instructor statistics' });
    }
});

// Get student dashboard stats
router.get('/student/dashboard-stats', authenticateToken, requireRole(['learner']), async (req, res) => {
    try {
        const userId = req.user._id;
        const Enrollment = require('../models/Enrollment');
        const Certificate = require('../models/Certificate');

        // Get enrollment statistics
        const [enrolledCount, completedCount, certificateCount] = await Promise.all([
            Enrollment.countDocuments({ user: userId, isActive: true }),
            Enrollment.countDocuments({ user: userId, completedAt: { $exists: true } }),
            Certificate.countDocuments({ user: userId })
        ]);

        // Get recent activity
        const recentEnrollments = await Enrollment.find({ user: userId })
            .populate('course', 'title')
            .sort('-enrolledAt')
            .limit(3);

        const recentCertificates = await Certificate.find({ user: userId })
            .populate('course', 'title')
            .sort('-issuedAt')
            .limit(3);

        // Calculate total learning time (you might want to track this separately)
        const totalLearningTime = "0h 0m"; // Placeholder

        const recentActivity = [
            ...recentCertificates.map(cert => ({
                type: 'certificate_earned',
                courseTitle: cert.course.title,
                date: cert.issuedAt
            })),
            ...recentEnrollments.map(enrollment => ({
                type: 'course_enrolled',
                courseTitle: enrollment.course.title,
                date: enrollment.enrolledAt
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

        res.json({
            coursesEnrolled: enrolledCount,
            coursesCompleted: completedCount,
            certificatesEarned: certificateCount,
            totalLearningTime,
            currentStreak: 0, // Placeholder for learning streak
            recentActivity
        });
    } catch (error) {
        console.error('Get student dashboard stats error:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
    }
});

// Get user's wishlist
router.get('/wishlist', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate({
                path: 'wishlist',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            });

        res.json({
            wishlist: user.wishlist || []
        });
    } catch (error) {
        console.error('Get wishlist error:', error);
        res.status(500).json({ message: 'Failed to fetch wishlist' });
    }
});

// Add course to wishlist
router.post('/wishlist/:courseId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const courseId = req.params.courseId;

        if (!user.wishlist.includes(courseId)) {
            user.wishlist.push(courseId);
            await user.save();
        }

        res.json({ message: 'Course added to wishlist' });
    } catch (error) {
        console.error('Add to wishlist error:', error);
        res.status(500).json({ message: 'Failed to add course to wishlist' });
    }
});

// Remove course from wishlist
router.delete('/wishlist/:courseId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.wishlist = user.wishlist.filter(id => id.toString() !== req.params.courseId);
        await user.save();

        res.json({ message: 'Course removed from wishlist' });
    } catch (error) {
        console.error('Remove from wishlist error:', error);
        res.status(500).json({ message: 'Failed to remove course from wishlist' });
    }
});

// Get user's shopping cart
router.get('/cart', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate({
                path: 'cart',
                populate: {
                    path: 'instructor',
                    select: 'name profile.avatar'
                }
            });

        const cartTotal = user.cart.reduce((total, course) => total + course.price, 0);

        res.json({
            cart: user.cart || [],
            cartTotal
        });
    } catch (error) {
        console.error('Get cart error:', error);
        res.status(500).json({ message: 'Failed to fetch cart' });
    }
});

// Add course to cart
router.post('/cart/:courseId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const courseId = req.params.courseId;

        if (!user.cart.includes(courseId)) {
            user.cart.push(courseId);
            await user.save();
        }

        res.json({ message: 'Course added to cart' });
    } catch (error) {
        console.error('Add to cart error:', error);
        res.status(500).json({ message: 'Failed to add course to cart' });
    }
});

// Remove course from cart
router.delete('/cart/:courseId', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.cart = user.cart.filter(id => id.toString() !== req.params.courseId);
        await user.save();

        res.json({ message: 'Course removed from cart' });
    } catch (error) {
        console.error('Remove from cart error:', error);
        res.status(500).json({ message: 'Failed to remove course from cart' });
    }
});

module.exports = router;