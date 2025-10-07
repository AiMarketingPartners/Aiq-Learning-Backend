const express = require('express');
const axios = require('axios');
const { body } = require('express-validator');
const Course = require('../models/Course');
const { authenticateToken, requireVerifiedInstructor } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// API.video configuration
const API_VIDEO_BASE_URL = process.env.APIVIDEO_BASE_URL || 'https://ws.api.video';
const API_VIDEO_API_KEY = process.env.APIVIDEO_API_KEY;

// Helper function to make API.video requests
const apiVideoRequest = async (method, endpoint, data = null) => {
    try {
        const config = {
            method,
            url: `${API_VIDEO_BASE_URL}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${API_VIDEO_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('API.video request error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.detail || 'API.video request failed');
    }
};

// Upload video to API.video
router.post('/upload', authenticateToken, requireVerifiedInstructor, [
    body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('tags').optional().isArray(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { title, description, tags } = req.body;

        // Create video in API.video
        const videoData = {
            title,
            description: description || '',
            tags: tags || [],
            metadata: [
                { key: 'instructor', value: req.user._id.toString() },
                { key: 'instructorName', value: req.user.name }
            ]
        };

        const video = await apiVideoRequest('POST', '/videos', videoData);

        res.status(201).json({
            message: 'Video created successfully',
            video: {
                videoId: video.videoId,
                title: video.title,
                description: video.description,
                assets: video.assets,
                source: video.source,
                publishedAt: video.publishedAt
            }
        });
    } catch (error) {
        console.error('Upload video error:', error);
        res.status(500).json({ 
            message: 'Failed to create video', 
            error: error.message 
        });
    }
});

// Get upload URL for direct upload
router.post('/upload-url', authenticateToken, requireVerifiedInstructor, [
    body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
    body('description').optional().trim(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { title, description } = req.body;

        // Create video and get upload token
        const videoData = {
            title,
            description: description || '',
            metadata: [
                { key: 'instructor', value: req.user._id.toString() },
                { key: 'instructorName', value: req.user.name }
            ]
        };

        const video = await apiVideoRequest('POST', '/videos', videoData);
        
        // Get upload token for progressive upload
        const uploadToken = await apiVideoRequest(
            'POST', 
            `/videos/${video.videoId}/source`
        );

        res.json({
            message: 'Upload URL generated successfully',
            videoId: video.videoId,
            uploadToken: uploadToken.token,
            uploadUrl: `${API_VIDEO_BASE_URL}/upload`,
            video: {
                videoId: video.videoId,
                title: video.title,
                description: video.description,
                status: video.status
            }
        });
    } catch (error) {
        console.error('Generate upload URL error:', error);
        res.status(500).json({ 
            message: 'Failed to generate upload URL', 
            error: error.message 
        });
    }
});

// Get video details
router.get('/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        const video = await apiVideoRequest('GET', `/videos/${videoId}`);

        // Check if user has access to this video
        const hasAccess = req.user.role === 'admin' || 
                         video.metadata?.find(m => m.key === 'instructor')?.value === req.user._id.toString();

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json({
            video: {
                videoId: video.videoId,
                title: video.title,
                description: video.description,
                duration: video.assets?.mp4 ? video.assets.mp4.duration : null,
                status: video.status,
                assets: video.assets,
                publishedAt: video.publishedAt,
                metadata: video.metadata
            }
        });
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({ 
            message: 'Failed to fetch video details', 
            error: error.message 
        });
    }
});

// Update video details
router.put('/:videoId', authenticateToken, requireVerifiedInstructor, [
    body('title').optional().trim().isLength({ min: 3, max: 200 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('tags').optional().isArray(),
    handleValidationErrors
], async (req, res) => {
    try {
        const { videoId } = req.params;
        const updates = {};

        if (req.body.title) updates.title = req.body.title;
        if (req.body.description) updates.description = req.body.description;
        if (req.body.tags) updates.tags = req.body.tags;

        // Check ownership
        const video = await apiVideoRequest('GET', `/videos/${videoId}`);
        const instructorId = video.metadata?.find(m => m.key === 'instructor')?.value;

        if (instructorId !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const updatedVideo = await apiVideoRequest('PATCH', `/videos/${videoId}`, updates);

        res.json({
            message: 'Video updated successfully',
            video: {
                videoId: updatedVideo.videoId,
                title: updatedVideo.title,
                description: updatedVideo.description,
                status: updatedVideo.status,
                assets: updatedVideo.assets
            }
        });
    } catch (error) {
        console.error('Update video error:', error);
        res.status(500).json({ 
            message: 'Failed to update video', 
            error: error.message 
        });
    }
});

// Delete video
router.delete('/:videoId', authenticateToken, requireVerifiedInstructor, async (req, res) => {
    try {
        const { videoId } = req.params;

        // Check ownership
        const video = await apiVideoRequest('GET', `/videos/${videoId}`);
        const instructorId = video.metadata?.find(m => m.key === 'instructor')?.value;

        if (instructorId !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if video is used in any courses
        const coursesUsingVideo = await Course.find({
            'sections.lessons.videoId': videoId
        });

        if (coursesUsingVideo.length > 0) {
            return res.status(400).json({ 
                message: 'Cannot delete video. It is being used in courses.',
                courses: coursesUsingVideo.map(c => ({ id: c._id, title: c.title }))
            });
        }

        await apiVideoRequest('DELETE', `/videos/${videoId}`);

        res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Delete video error:', error);
        res.status(500).json({ 
            message: 'Failed to delete video', 
            error: error.message 
        });
    }
});

// Get instructor's videos
router.get('/instructor/my-videos', authenticateToken, requireVerifiedInstructor, async (req, res) => {
    try {
        const { page = 1, limit = 12 } = req.query;

        // Get videos from API.video with instructor metadata
        const response = await apiVideoRequest(
            'GET', 
            `/videos?currentPage=${page}&pageSize=${limit}&metadata[instructor]=${req.user._id}`
        );

        const videos = response.data.map(video => ({
            videoId: video.videoId,
            title: video.title,
            description: video.description,
            duration: video.assets?.mp4 ? video.assets.mp4.duration : null,
            status: video.status,
            thumbnail: video.assets?.thumbnail,
            createdAt: video.createdAt,
            publishedAt: video.publishedAt
        }));

        res.json({
            videos,
            pagination: response.pagination
        });
    } catch (error) {
        console.error('Get instructor videos error:', error);
        res.status(500).json({ 
            message: 'Failed to fetch videos', 
            error: error.message 
        });
    }
});

// Get video analytics
router.get('/:videoId/analytics', authenticateToken, requireVerifiedInstructor, async (req, res) => {
    try {
        const { videoId } = req.params;
        const { from, to } = req.query;

        // Check ownership
        const video = await apiVideoRequest('GET', `/videos/${videoId}`);
        const instructorId = video.metadata?.find(m => m.key === 'instructor')?.value;

        if (instructorId !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        let analyticsEndpoint = `/analytics/videos/${videoId}`;
        if (from || to) {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            analyticsEndpoint += `?${params.toString()}`;
        }

        const analytics = await apiVideoRequest('GET', analyticsEndpoint);

        res.json({
            videoId,
            analytics: {
                views: analytics.data?.reduce((sum, item) => sum + (item.views || 0), 0) || 0,
                impressions: analytics.data?.reduce((sum, item) => sum + (item.impressions || 0), 0) || 0,
                watchTime: analytics.data?.reduce((sum, item) => sum + (item.watchTime || 0), 0) || 0,
                data: analytics.data || []
            }
        });
    } catch (error) {
        console.error('Get video analytics error:', error);
        res.status(500).json({ 
            message: 'Failed to fetch video analytics', 
            error: error.message 
        });
    }
});

// Add video to course lesson
router.post('/add-to-lesson', authenticateToken, requireVerifiedInstructor, [
    body('courseId').isMongoId().withMessage('Valid course ID required'),
    body('sectionId').isMongoId().withMessage('Valid section ID required'),
    body('lessonId').isMongoId().withMessage('Valid lesson ID required'),
    body('videoId').trim().notEmpty().withMessage('Video ID required'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { courseId, sectionId, lessonId, videoId } = req.body;

        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (course.instructor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Get video details from API.video
        const video = await apiVideoRequest('GET', `/videos/${videoId}`);

        // Find section and lesson
        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ message: 'Section not found' });
        }

        const lesson = section.lessons.id(lessonId);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        // Update lesson with video details
        lesson.videoId = videoId;
        lesson.videoUrl = video.assets?.player || '';
        lesson.videoDuration = video.assets?.mp4 ? video.assets.mp4.duration : 0;

        await course.save();

        res.json({
            message: 'Video added to lesson successfully',
            lesson: {
                _id: lesson._id,
                title: lesson.title,
                videoId: lesson.videoId,
                videoDuration: lesson.videoDuration
            }
        });
    } catch (error) {
        console.error('Add video to lesson error:', error);
        res.status(500).json({ 
            message: 'Failed to add video to lesson', 
            error: error.message 
        });
    }
});

module.exports = router;