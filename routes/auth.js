const express = require('express');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const User = require('../models/User');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register user
router.post('/register', [
    body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['learner', 'instructor']).withMessage('Role must be learner or instructor'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // Create user
        const user = new User({
            name,
            email,
            password,
            role: role || 'learner'
        });

        await user.save();

        // Generate token
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: user.getPublicProfile()
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
});

// Login user
router.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({ message: 'Account is deactivated' });
        }

        // Check instructor verification
        if (user.role === 'instructor' && (!user.isVerified || user.instructor.verificationStatus !== 'approved')) {
            return res.status(401).json({ 
                message: 'Instructor account pending verification. Please wait for admin approval.',
                verificationStatus: user.instructor.verificationStatus
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate token
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: user.getPublicProfile()
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        res.json({
            user: req.user.getPublicProfile()
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
});

// Update user profile
router.put('/profile', authenticateToken, [
    body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('profile.bio').optional().trim().isLength({ max: 500 }).withMessage('Bio must be less than 500 characters'),
    body('profile.phone').optional().trim(),
    body('profile.country').optional().trim(),
    handleValidationErrors
], async (req, res) => {
    try {
        const allowedUpdates = ['name', 'profile'];
        const updates = {};

        allowedUpdates.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'profile') {
                    updates[field] = { ...req.user.profile, ...req.body[field] };
                } else {
                    updates[field] = req.body[field];
                }
            }
        });

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        );

        res.json({
            message: 'Profile updated successfully',
            user: user.getPublicProfile()
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: 'Profile update failed', error: error.message });
    }
});

// Update instructor profile
router.put('/instructor-profile', authenticateToken, [
    body('instructor.expertise').optional().isArray().withMessage('Expertise must be an array'),
    body('instructor.experience').optional().trim().isLength({ max: 1000 }).withMessage('Experience must be less than 1000 characters'),
    body('instructor.qualifications').optional().trim().isLength({ max: 1000 }).withMessage('Qualifications must be less than 1000 characters'),
    handleValidationErrors
], async (req, res) => {
    try {
        if (req.user.role !== 'instructor') {
            return res.status(403).json({ message: 'Only instructors can update instructor profile' });
        }

        const updates = {};
        if (req.body.instructor) {
            updates.instructor = { ...req.user.instructor, ...req.body.instructor };
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        );

        res.json({
            message: 'Instructor profile updated successfully',
            user: user.getPublicProfile()
        });
    } catch (error) {
        console.error('Instructor profile update error:', error);
        res.status(500).json({ message: 'Instructor profile update failed', error: error.message });
    }
});

// Change password
router.put('/change-password', authenticateToken, [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Check current password
        const isMatch = await req.user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Update password
        req.user.password = newPassword;
        await req.user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ message: 'Password change failed', error: error.message });
    }
});

module.exports = router;