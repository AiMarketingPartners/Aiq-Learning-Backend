const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireVerifiedInstructor, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const VideoService = require('../services/VideoService');
const Course = require('../models/Course');
const User = require('../models/User');

// Initialize video service
const videoService = new VideoService();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/videos';
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
        fileSize: 5 * 1024 * 1024 * 1024 // 5GB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video') {
            // Accept video files
            if (file.mimetype.startsWith('video/')) {
                cb(null, true);
            } else {
                cb(new Error('Only video files are allowed'), false);
            }
        } else if (file.fieldname === 'thumbnail') {
            // Accept image files for thumbnails
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only image files are allowed for thumbnails'), false);
            }
        } else {
            cb(new Error('Unexpected field'), false);
        }
    }
});

// @route   POST /api/videos/create
// @desc    Create a new video entry in API.video
// @access  Private (Verified Instructor)
router.post('/create',
    authenticateToken,
    requireVerifiedInstructor,
    [
        body('title').notEmpty().withMessage('Title is required'),
        body('description').optional().isString(),
        body('tags').optional().isArray(),
        body('isPublic').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { title, description, tags, isPublic, metadata } = req.body;

            const result = await videoService.createVideo({
                title,
                description,
                tags,
                isPublic,
                metadata: metadata || [
                    { key: 'instructor', value: req.user.name },
                    { key: 'instructorId', value: req.user.userId }
                ]
            });

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to create video',
                    error: result.error
                });
            }

            res.status(201).json({
                message: 'Video created successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Create video error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   POST /api/videos/upload-token
// @desc    Get upload token for direct video upload to API.video
// @access  Private (Verified Instructor)
router.post('/upload-token',
    authenticateToken,
    requireVerifiedInstructor,
    [
        body('title').notEmpty().withMessage('Title is required'),
        body('description').optional().isString(),
        body('tags').optional().isArray()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { title, description, tags, isPublic } = req.body;

            const result = await videoService.getUploadToken({
                title,
                description,
                tags,
                isPublic,
                metadata: [
                    { key: 'instructor', value: req.user.name },
                    { key: 'instructorId', value: req.user.userId }
                ]
            });

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to get upload token',
                    error: result.error
                });
            }

            res.json({
                message: 'Upload token generated successfully',
                uploadInfo: result.uploadInfo
            });
        } catch (error) {
            console.error('Upload token error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   POST /api/videos/:videoId/upload-file
// @desc    Upload video file to API.video
// @access  Private (Verified Instructor)
router.post('/:videoId/upload-file',
    authenticateToken,
    requireVerifiedInstructor,
    upload.single('video'),
    async (req, res) => {
        try {
            const { videoId } = req.params;
            
            if (!req.file) {
                return res.status(400).json({
                    message: 'No video file provided'
                });
            }

            // Upload to API.video
            const result = await videoService.uploadVideo(
                videoId, 
                req.file.path,
                (event) => {
                    // You could emit progress events via WebSocket here
                    const progress = (event.currentChunk / event.chunksCount) * 100;
                    console.log(`Upload progress for ${videoId}: ${progress.toFixed(2)}%`);
                }
            );

            // Clean up local file
            fs.unlinkSync(req.file.path);

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to upload video',
                    error: result.error
                });
            }

            res.json({
                message: 'Video uploaded successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Upload video error:', error);
            
            // Clean up local file if it exists
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   POST /api/videos/:videoId/thumbnail
// @desc    Upload custom thumbnail for video
// @access  Private (Video Owner/Admin)
router.post('/:videoId/thumbnail',
    authenticateToken,
    upload.single('thumbnail'),
    async (req, res) => {
        try {
            const { videoId } = req.params;
            
            if (!req.file) {
                return res.status(400).json({
                    message: 'No thumbnail file provided'
                });
            }

            // Verify ownership or admin access
            const videoDetails = await videoService.getVideo(videoId);
            if (!videoDetails.success) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(404).json({
                    message: 'Video not found'
                });
            }

            // Upload thumbnail to API.video
            const result = await videoService.uploadThumbnail(videoId, req.file.path);

            // Clean up local file
            fs.unlinkSync(req.file.path);

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to upload thumbnail',
                    error: result.error
                });
            }

            res.json({
                message: 'Thumbnail uploaded successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Upload thumbnail error:', error);
            
            // Clean up local file if it exists
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   PATCH /api/videos/:videoId/thumbnail-timecode
// @desc    Set thumbnail from video timecode
// @access  Private (Video Owner/Admin)
router.patch('/:videoId/thumbnail-timecode',
    authenticateToken,
    [
        body('timecode').notEmpty().withMessage('Timecode is required')
            .matches(/^\d{2}:\d{2}:\d{2}\.\d{3}$/).withMessage('Timecode must be in format HH:MM:SS.mmm')
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { videoId } = req.params;
            const { timecode } = req.body;

            const result = await videoService.setThumbnailFromTimecode(videoId, timecode);

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to set thumbnail from timecode',
                    error: result.error
                });
            }

            res.json({
                message: 'Thumbnail set successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Set thumbnail timecode error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   GET /api/videos/:videoId
// @desc    Get video details from API.video
// @access  Private
router.get('/:videoId',
    authenticateToken,
    async (req, res) => {
        try {
            const { videoId } = req.params;
            console.log('GET /api/videos/:videoId - videoId received:', videoId);
            console.log('GET /api/videos/:videoId - full URL:', req.originalUrl);

            if (!videoId || videoId === 'undefined' || videoId === 'null') {
                return res.status(400).json({
                    message: 'Invalid video ID provided',
                    videoId: videoId
                });
            }

            const result = await videoService.getVideo(videoId);

            if (!result.success) {
                console.log('GET /api/videos/:videoId - Video not found, error:', result.error);
                return res.status(404).json({
                    message: 'Video not found',
                    error: result.error
                });
            }

            console.log('GET /api/videos/:videoId - Sending response:', JSON.stringify(result.video, null, 2));

            res.json({
                message: 'Video retrieved successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Get video error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   PUT /api/videos/:videoId
// @desc    Update video metadata
// @access  Private (Video Owner/Admin)
router.put('/:videoId',
    authenticateToken,
    [
        body('title').optional().notEmpty().withMessage('Title cannot be empty'),
        body('description').optional().isString(),
        body('tags').optional().isArray(),
        body('metadata').optional().isArray()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { videoId } = req.params;
            const updateData = req.body;

            const result = await videoService.updateVideo(videoId, updateData);

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to update video',
                    error: result.error
                });
            }

            res.json({
                message: 'Video updated successfully',
                video: result.video
            });
        } catch (error) {
            console.error('Update video error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   DELETE /api/videos/:videoId
// @desc    Delete video from API.video
// @access  Private (Video Owner/Admin)
router.delete('/:videoId',
    authenticateToken,
    async (req, res) => {
        try {
            const { videoId } = req.params;

            // Check if video is used in any courses
            const coursesUsingVideo = await Course.find({
                'sections.lectures.video.apiVideoId': videoId
            });

            if (coursesUsingVideo.length > 0 && req.user.role !== 'admin') {
                return res.status(400).json({
                    message: 'Cannot delete video that is used in courses',
                    coursesCount: coursesUsingVideo.length
                });
            }

            const result = await videoService.deleteVideo(videoId);

            if (!result.success) {
                return res.status(400).json({
                    message: 'Failed to delete video',
                    error: result.error
                });
            }

            // Remove video references from courses if admin
            if (coursesUsingVideo.length > 0) {
                for (const course of coursesUsingVideo) {
                    course.sections.forEach(section => {
                        section.lectures.forEach(lecture => {
                            if (lecture.type === 'video' && lecture.video.apiVideoId === videoId) {
                                lecture.video = {};
                                lecture.type = 'note'; // Convert to note type
                                lecture.note = {
                                    content: 'Video has been removed by administrator.',
                                    estimatedReadTime: 1
                                };
                            }
                        });
                    });
                    await course.save();
                }
            }

            res.json({
                message: 'Video deleted successfully',
                removedFromCourses: coursesUsingVideo.length
            });
        } catch (error) {
            console.error('Delete video error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   GET /api/videos/instructor/my-videos
// @desc    Get instructor's videos
// @access  Private (Verified Instructor)
router.get('/instructor/my-videos',
    authenticateToken,
    requireVerifiedInstructor,
    async (req, res) => {
        try {
            const { page = 1, limit = 12 } = req.query;
            
            // Find courses by this instructor that contain videos
            const courses = await Course.find({
                instructor: req.user.userId,
                'sections.lectures.type': 'video'
            }).select('title sections.lectures');

            const videos = [];
            
            courses.forEach(course => {
                course.sections.forEach(section => {
                    section.lectures.forEach(lecture => {
                        if (lecture.type === 'video' && lecture.video.apiVideoId) {
                            videos.push({
                                videoId: lecture.video.apiVideoId,
                                title: lecture.title,
                                courseTitle: course.title,
                                courseId: course._id,
                                lectureId: lecture._id,
                                embedUrl: lecture.video.embedUrl,
                                thumbnailUrl: lecture.video.thumbnailUrl,
                                duration: lecture.video.duration,
                                createdAt: lecture.createdAt
                            });
                        }
                    });
                });
            });

            // Pagination
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const paginatedVideos = videos.slice(startIndex, endIndex);

            res.json({
                message: 'Videos retrieved successfully',
                videos: paginatedVideos,
                pagination: {
                    current: parseInt(page),
                    total: Math.ceil(videos.length / limit),
                    count: paginatedVideos.length,
                    totalVideos: videos.length
                }
            });
        } catch (error) {
            console.error('Get instructor videos error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// @route   POST /api/videos/add-to-lecture
// @desc    Add video to course lecture
// @access  Private (Course Owner)
router.post('/add-to-lecture',
    authenticateToken,
    [
        body('courseId').notEmpty().withMessage('Course ID is required'),
        body('sectionIndex').isNumeric().withMessage('Section index is required'),
        body('lectureIndex').isNumeric().withMessage('Lecture index is required'),
        body('videoId').notEmpty().withMessage('Video ID is required')
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { courseId, sectionIndex, lectureIndex, videoId } = req.body;

            // Find the course
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({
                    message: 'Course not found'
                });
            }

            // Check ownership
            if (!course.instructor.equals(req.user.userId) && req.user.role !== 'admin') {
                return res.status(403).json({
                    message: 'Not authorized to modify this course'
                });
            }

            // Validate section and lecture indices
            if (!course.sections[sectionIndex] || !course.sections[sectionIndex].lectures[lectureIndex]) {
                return res.status(400).json({
                    message: 'Invalid section or lecture index'
                });
            }

            // Get video details from API.video
            const videoResult = await videoService.getVideo(videoId);
            if (!videoResult.success) {
                return res.status(400).json({
                    message: 'Failed to get video details',
                    error: videoResult.error
                });
            }

            const lecture = course.sections[sectionIndex].lectures[lectureIndex];
            
            // Update lecture with video data
            lecture.type = 'video';
            lecture.video = {
                apiVideoId: videoResult.video.videoId,
                embedUrl: videoResult.video.embedUrl,
                playerUrl: videoResult.video.playerUrl,
                thumbnailUrl: videoResult.video.thumbnailUrl,
                hlsUrl: videoResult.video.hlsUrl,
                mp4Url: videoResult.video.mp4Url,
                duration: videoResult.video.duration
            };
            lecture.duration = videoResult.video.duration;

            await course.save();

            res.json({
                message: 'Video added to lecture successfully',
                lecture: lecture
            });
        } catch (error) {
            console.error('Add video to lecture error:', error);
            res.status(500).json({
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;