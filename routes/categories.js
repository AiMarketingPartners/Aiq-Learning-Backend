const express = require('express');
const { body } = require('express-validator');
const Category = require('../models/Category');
const Course = require('../models/Course');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Get all categories (public)
router.get('/', async (req, res) => {
    try {
        const { active = 'true' } = req.query;
        
        const filter = {};
        if (active === 'true') {
            filter.isActive = true;
        }

        const categories = await Category.find(filter).sort({ name: 1 });
        
        res.json({ categories });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
});

// Create category (admin only)
router.post('/', authenticateToken, requireRole(['admin']), [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters'),
    body('icon').optional().trim(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { name, description, icon } = req.body;

        // Check if category exists
        const existingCategory = await Category.findOne({ name: name.toLowerCase() });
        if (existingCategory) {
            return res.status(400).json({ message: 'Category already exists' });
        }

        const category = new Category({
            name: name.toLowerCase(),
            description,
            icon
        });

        await category.save();

        res.status(201).json({
            message: 'Category created successfully',
            category
        });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ message: 'Failed to create category' });
    }
});

// Update category (admin only)
router.put('/:categoryId', authenticateToken, requireRole(['admin']), [
    body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('description').optional().trim().isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters'),
    body('icon').optional().trim(),
    body('isActive').optional().isBoolean(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { categoryId } = req.params;
        const updates = req.body;

        if (updates.name) {
            updates.name = updates.name.toLowerCase();
            
            // Check if name already exists (excluding current category)
            const existingCategory = await Category.findOne({ 
                name: updates.name,
                _id: { $ne: categoryId }
            });
            if (existingCategory) {
                return res.status(400).json({ message: 'Category name already exists' });
            }
        }

        const category = await Category.findByIdAndUpdate(
            categoryId,
            updates,
            { new: true, runValidators: true }
        );

        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        res.json({
            message: 'Category updated successfully',
            category
        });
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ message: 'Failed to update category' });
    }
});

// Delete category (admin only)
router.delete('/:categoryId', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { categoryId } = req.params;

        // Check if category has courses
        const coursesCount = await Course.countDocuments({ category: categoryId });
        if (coursesCount > 0) {
            return res.status(400).json({ 
                message: `Cannot delete category. It has ${coursesCount} courses associated with it.` 
            });
        }

        const category = await Category.findByIdAndDelete(categoryId);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ message: 'Failed to delete category' });
    }
});

// Get category by ID with courses
router.get('/:categoryId', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        const courses = await Course.find({ 
            category: categoryId,
            isPublished: true 
        })
        .populate('instructor', 'name profile.avatar')
        .select('-sections.lessons.videoUrl') // Don't expose video URLs in list
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

        const totalCourses = await Course.countDocuments({ 
            category: categoryId,
            isPublished: true 
        });

        res.json({
            category,
            courses,
            totalPages: Math.ceil(totalCourses / limit),
            currentPage: parseInt(page),
            totalCourses
        });
    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({ message: 'Failed to fetch category' });
    }
});

module.exports = router;