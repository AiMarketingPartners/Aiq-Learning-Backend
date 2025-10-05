const express = require('express');
const User = require('../models/User');
const Course = require('../models/Course');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get user's wishlist
router.get('/',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;
            
            const user = await User.findById(userId)
                .populate({
                    path: 'learner.wishlist',
                    populate: {
                        path: 'instructor',
                        select: 'name profileImage'
                    }
                })
                .populate({
                    path: 'learner.wishlist',
                    populate: {
                        path: 'category',
                        select: 'name'
                    }
                });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Initialize learner object if it doesn't exist
            if (!user.learner) {
                user.learner = { cart: [], wishlist: [], enrolledCourses: [], completedCourses: [], certificates: [] };
            }

            res.json({
                wishlist: user.learner?.wishlist || [],
                total: user.learner?.wishlist?.length || 0
            });
        } catch (error) {
            console.error('Get wishlist error:', error);
            res.status(500).json({ message: 'Failed to fetch wishlist' });
        }
    }
);

// Add course to wishlist
router.post('/:courseId',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;
            const { courseId } = req.params;

            // Check if course exists and is published
            const course = await Course.findById(courseId);
            if (!course || !course.isPublished) {
                return res.status(404).json({ message: 'Course not found or not published' });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Initialize learner object if it doesn't exist
            if (!user.learner) {
                user.learner = { cart: [], wishlist: [], enrolledCourses: [], completedCourses: [], certificates: [] };
            }

            // Check if course is already in wishlist
            if (user.learner.wishlist.includes(courseId)) {
                return res.status(400).json({ message: 'Course already in wishlist' });
            }

            // Add to wishlist
            user.learner.wishlist.push(courseId);
            await user.save();

            res.json({ 
                message: 'Course added to wishlist',
                wishlist: user.learner.wishlist
            });
        } catch (error) {
            console.error('Add to wishlist error:', error);
            res.status(500).json({ message: 'Failed to add course to wishlist' });
        }
    }
);

// Remove course from wishlist
router.delete('/:courseId',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;
            const { courseId } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Initialize learner object if it doesn't exist
            if (!user.learner) {
                user.learner = { cart: [], wishlist: [], enrolledCourses: [], completedCourses: [], certificates: [] };
            }

            // Remove from wishlist
            user.learner.wishlist = user.learner.wishlist.filter(id => id.toString() !== courseId);
            await user.save();

            res.json({ 
                message: 'Course removed from wishlist',
                wishlist: user.learner.wishlist
            });
        } catch (error) {
            console.error('Remove from wishlist error:', error);
            res.status(500).json({ message: 'Failed to remove course from wishlist' });
        }
    }
);

// Check if course is in wishlist
router.get('/check/:courseId',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;
            const { courseId } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Initialize learner object if it doesn't exist
            if (!user.learner) {
                user.learner = { cart: [], wishlist: [], enrolledCourses: [], completedCourses: [], certificates: [] };
            }

            const isInWishlist = user.learner.wishlist.includes(courseId);
            res.json({ isInWishlist });
        } catch (error) {
            console.error('Check wishlist error:', error);
            res.status(500).json({ message: 'Failed to check wishlist' });
        }
    }
);

module.exports = router;