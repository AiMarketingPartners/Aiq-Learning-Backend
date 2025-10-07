const express = require('express');
const User = require('../models/User');
const Course = require('../models/Course');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get user's cart
router.get('/',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;
            
            const user = await User.findById(userId)
                .populate({
                    path: 'learner.cart',
                    populate: {
                        path: 'instructor',
                        select: 'name profileImage'
                    }
                })
                .populate({
                    path: 'learner.cart',
                    populate: {
                        path: 'category',
                        select: 'name'
                    }
                });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Calculate total price
            const cart = user.learner?.cart || [];
            const totalPrice = cart.reduce((total, course) => total + course.price, 0);

            res.json({
                cart: cart,
                total: cart.length,
                totalPrice
            });
        } catch (error) {
            console.error('Get cart error:', error);
            res.status(500).json({ message: 'Failed to fetch cart' });
        }
    }
);

// Add course to cart
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

            // Check if course is already in cart
            if (user.learner.cart.includes(courseId)) {
                return res.status(400).json({ message: 'Course already in cart' });
            }

            // Add to cart
            user.learner.cart.push(courseId);
            await user.save();

            res.json({ 
                message: 'Course added to cart',
                cart: user.learner.cart
            });
        } catch (error) {
            console.error('Add to cart error:', error);
            res.status(500).json({ message: 'Failed to add course to cart' });
        }
    }
);

// Remove course from cart
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

            // Remove from cart
            user.learner.cart = user.learner.cart.filter(id => id.toString() !== courseId);
            await user.save();

            res.json({ 
                message: 'Course removed from cart',
                cart: user.learner.cart
            });
        } catch (error) {
            console.error('Remove from cart error:', error);
            res.status(500).json({ message: 'Failed to remove course from cart' });
        }
    }
);

// Check if course is in cart
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

            const isInCart = user.learner.cart.includes(courseId);
            res.json({ isInCart });
        } catch (error) {
            console.error('Check cart error:', error);
            res.status(500).json({ message: 'Failed to check cart' });
        }
    }
);

// Clear entire cart
router.delete('/',
    authenticateToken,
    requireRole('learner'),
    async (req, res) => {
        try {
            const userId = req.user._id;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Initialize learner object if it doesn't exist
            if (!user.learner) {
                user.learner = { cart: [], wishlist: [], enrolledCourses: [], completedCourses: [], certificates: [] };
            }

            user.learner.cart = [];
            await user.save();

            res.json({ message: 'Cart cleared' });
        } catch (error) {
            console.error('Clear cart error:', error);
            res.status(500).json({ message: 'Failed to clear cart' });
        }
    }
);

module.exports = router;