const ApiVideoClient = require('@api.video/nodejs-client');
const fs = require('fs');
const path = require('path');

class VideoService {
    constructor() {
        this.client = new ApiVideoClient({ 
            apiKey: process.env.APIVIDEO_API_KEY 
        });
    }

    /**
     * Create a new video entry in API.video
     * @param {Object} videoData - Video metadata
     * @returns {Object} Video object from API.video
     */
    async createVideo(videoData) {
        try {
            const video = await this.client.videos.create({
                title: videoData.title,
                description: videoData.description || '',
                _public: videoData.isPublic || false,
                mp4Support: true,
                tags: videoData.tags || [],
                metadata: videoData.metadata || []
            });

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    title: video.title,
                    description: video.description,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player,
                    thumbnailUrl: video.assets.thumbnail,
                    hlsUrl: video.assets.hls,
                    mp4Url: video.assets.mp4,
                    uploadUri: video.source.uri,
                    isPublic: video.public,
                    createdAt: video.createdAt || video.publishedAt
                }
            };
        } catch (error) {
            console.error('Error creating video:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Upload video file to API.video
     * @param {string} videoId - API.video video ID
     * @param {string|Buffer} filePathOrBuffer - Path to video file or Buffer
     * @param {string} filename - Original filename (when using buffer)
     * @param {Function} progressCallback - Progress callback function
     * @returns {Object} Updated video object
     */
    async uploadVideo(videoId, filePathOrBuffer, filename = null, progressCallback = null) {
        try {
            let video;
            
            if (Buffer.isBuffer(filePathOrBuffer)) {
                // Handle buffer upload - save temporarily
                const tempDir = path.join(__dirname, '../temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const tempFilePath = path.join(tempDir, `${videoId}-${filename || 'video.mp4'}`);
                fs.writeFileSync(tempFilePath, filePathOrBuffer);
                
                console.log(`📹 Temporary file saved: ${tempFilePath}`);
                
                video = await this.client.videos.upload(
                    videoId, 
                    tempFilePath, 
                    progressCallback || ((event) => {
                        const progress = (event.currentChunk / event.chunksCount) * 100;
                        console.log(`Upload progress: ${progress.toFixed(2)}%`);
                    })
                );
                
                // Clean up temporary file
                fs.unlinkSync(tempFilePath);
                console.log(`📹 Temporary file cleaned up: ${tempFilePath}`);
            } else {
                // Handle file path upload
                if (!fs.existsSync(filePathOrBuffer)) {
                    throw new Error('Video file not found');
                }

                video = await this.client.videos.upload(
                    videoId, 
                    filePathOrBuffer, 
                    progressCallback || ((event) => {
                        const progress = (event.currentChunk / event.chunksCount) * 100;
                        console.log(`Upload progress: ${progress.toFixed(2)}%`);
                    })
                );
            }

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    title: video.title,
                    description: video.description,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player,
                    thumbnailUrl: video.assets.thumbnail,
                    hlsUrl: video.assets.hls,
                    mp4Url: video.assets.mp4,
                    duration: video.duration || 0,
                    publishedAt: video.publishedAt
                }
            };
        } catch (error) {
            console.error('Error uploading video:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Upload custom thumbnail for video
     * @param {string} videoId - API.video video ID
     * @param {string|Buffer} thumbnailPathOrBuffer - Path to thumbnail image or Buffer
     * @param {string} filename - Original filename (when using buffer)
     * @returns {Object} Updated video object
     */
    async uploadThumbnail(videoId, thumbnailPathOrBuffer, filename = 'thumbnail.jpg') {
        try {
            let video;
            
            if (Buffer.isBuffer(thumbnailPathOrBuffer)) {
                // Handle buffer upload - save temporarily
                const tempDir = path.join(__dirname, '../temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const tempFilePath = path.join(tempDir, `${videoId}-${filename}`);
                fs.writeFileSync(tempFilePath, thumbnailPathOrBuffer);
                
                console.log(`📹 Temporary thumbnail saved: ${tempFilePath}`);
                
                video = await this.client.videos.uploadThumbnail(videoId, tempFilePath);
                
                // Clean up temporary file
                fs.unlinkSync(tempFilePath);
                console.log(`📹 Temporary thumbnail cleaned up: ${tempFilePath}`);
            } else {
                // Handle file path upload
                if (!fs.existsSync(thumbnailPathOrBuffer)) {
                    throw new Error('Thumbnail file not found');
                }

                video = await this.client.videos.uploadThumbnail(videoId, thumbnailPathOrBuffer);
            }

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    thumbnailUrl: video.assets.thumbnail,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player
                }
            };
        } catch (error) {
            console.error('Error uploading thumbnail:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Set thumbnail from video timecode
     * @param {string} videoId - API.video video ID
     * @param {string} timecode - Timecode in format "00:01:30.000"
     * @returns {Object} Updated video object
     */
    async setThumbnailFromTimecode(videoId, timecode) {
        try {
            const video = await this.client.videos.pickThumbnail(videoId, {
                timecode: timecode
            });

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    thumbnailUrl: video.assets.thumbnail,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player
                }
            };
        } catch (error) {
            console.error('Error setting thumbnail from timecode:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get video details from API.video
     * @param {string} videoId - API.video video ID
     * @returns {Object} Video details
     */
    async getVideo(videoId) {
        try {
            console.log('VideoService.getVideo - videoId:', videoId);
            console.log('VideoService.getVideo - videoId type:', typeof videoId);
            
            if (!videoId || videoId === 'undefined' || videoId === 'null') {
                throw new Error('Invalid video ID provided to VideoService');
            }

            const video = await this.client.videos.get(videoId);
            console.log('VideoService.getVideo - API.video response received');
            console.log('VideoService.getVideo - Full video object:', JSON.stringify(video, null, 2));
            console.log('VideoService.getVideo - Video assets:', JSON.stringify(video.assets, null, 2));

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    title: video.title,
                    description: video.description,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player,
                    thumbnailUrl: video.assets.thumbnail,
                    hlsUrl: video.assets.hls,
                    mp4Url: video.assets.mp4,
                    duration: video.duration || 0,
                    isPublic: video.public,
                    tags: video.tags,
                    metadata: video.metadata,
                    createdAt: video.createdAt,
                    updatedAt: video.updatedAt,
                    publishedAt: video.publishedAt,
                    // Include the full assets object for frontend use
                    assets: video.assets
                }
            };
        } catch (error) {
            console.error('Error getting video:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update video metadata
     * @param {string} videoId - API.video video ID
     * @param {Object} updateData - Data to update
     * @returns {Object} Updated video object
     */
    async updateVideo(videoId, updateData) {
        try {
            const video = await this.client.videos.update(videoId, updateData);

            return {
                success: true,
                video: {
                    videoId: video.videoId,
                    title: video.title,
                    description: video.description,
                    embedUrl: video.assets.iframe,
                    playerUrl: video.assets.player,
                    thumbnailUrl: video.assets.thumbnail,
                    hlsUrl: video.assets.hls,
                    mp4Url: video.assets.mp4,
                    duration: video.duration || 0,
                    tags: video.tags,
                    metadata: video.metadata
                }
            };
        } catch (error) {
            console.error('Error updating video:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Replace video file by creating new video and optionally deleting old one
     * @param {string} oldVideoId - Existing video ID (will be deleted if replaceFile is true)
     * @param {Object} videoData - Video metadata for new video
     * @param {string|Buffer} filePathOrBuffer - Path to video file or Buffer
     * @param {string} filename - Original filename (when using buffer)
     * @param {Function} progressCallback - Progress callback function
     * @param {boolean} deleteOld - Whether to delete the old video
     * @returns {Object} New video object
     */
    async replaceVideoFile(oldVideoId, videoData, filePathOrBuffer, filename = null, progressCallback = null, deleteOld = true) {
        try {
            // Create new video with same metadata
            const createResult = await this.createVideo(videoData);
            
            if (!createResult.success) {
                return createResult;
            }

            const newVideoId = createResult.video.videoId;

            // Upload new video file
            const uploadResult = await this.uploadVideo(
                newVideoId,
                filePathOrBuffer,
                filename,
                progressCallback
            );

            if (!uploadResult.success) {
                // Cleanup: delete the newly created video if upload failed
                await this.deleteVideo(newVideoId);
                return uploadResult;
            }

            // Delete old video if requested
            if (deleteOld && oldVideoId) {
                const deleteResult = await this.deleteVideo(oldVideoId);
                if (!deleteResult.success) {
                    console.warn('Failed to delete old video:', deleteResult.error);
                }
            }

            return {
                success: true,
                video: uploadResult.video,
                oldVideoId: oldVideoId,
                newVideoId: newVideoId
            };
        } catch (error) {
            console.error('Error replacing video file:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Delete video from API.video
     * @param {string} videoId - API.video video ID
     * @returns {Object} Delete result
     */
    async deleteVideo(videoId) {
        try {
            await this.client.videos.delete(videoId);

            return {
                success: true,
                message: 'Video deleted successfully'
            };
        } catch (error) {
            console.error('Error deleting video:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get upload token for direct upload to API.video
     * @param {Object} videoData - Video metadata
     * @returns {Object} Upload token and URL
     */
    async getUploadToken(videoData) {
        try {
            // Create video first
            const videoResult = await this.createVideo(videoData);
            
            if (!videoResult.success) {
                return videoResult;
            }

            // Return upload information
            return {
                success: true,
                uploadInfo: {
                    videoId: videoResult.video.videoId,
                    uploadUri: videoResult.video.uploadUri,
                    video: videoResult.video
                }
            };
        } catch (error) {
            console.error('Error getting upload token:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Format timecode from seconds
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted timecode (HH:MM:SS.mmm)
     */
    formatTimecode(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }
}

module.exports = VideoService;