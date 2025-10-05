const Certificate = require('../models/Certificate');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Progress = require('../models/Progress');

class CertificateService {
    /**
     * Check if user is eligible for certificate
     * @param {string} userId - User ID
     * @param {string} courseId - Course ID
     * @returns {Object} Eligibility result
     */
    async checkEligibility(userId, courseId) {
        try {
            // Get course with certificate configuration
            const course = await Course.findById(courseId);
            if (!course || !course.certificate.enabled) {
                return {
                    eligible: false,
                    reason: 'Certificate not enabled for this course'
                };
            }

            // Check enrollment
            const enrollment = await Enrollment.findOne({
                user: userId,
                course: courseId,
                isActive: true
            });

            if (!enrollment) {
                return {
                    eligible: false,
                    reason: 'User not enrolled in this course'
                };
            }

            // Check if already has certificate
            const existingCertificate = await Certificate.findOne({
                user: userId,
                course: courseId
            });

            if (existingCertificate) {
                return {
                    eligible: false,
                    reason: 'Certificate already issued',
                    certificate: existingCertificate
                };
            }

            // Check progress
            const progress = await Progress.findOne({
                user: userId,
                course: courseId
            });

            if (!progress) {
                return {
                    eligible: false,
                    reason: 'No progress found for this course'
                };
            }

            const completionPercentage = progress.completionPercentage || 0;
            const requiredCompletion = course.certificate.completionRequirement || 100;

            if (completionPercentage < requiredCompletion) {
                return {
                    eligible: false,
                    reason: `Course completion required: ${requiredCompletion}%. Current: ${completionPercentage}%`
                };
            }

            // Check quiz scores if course has quizzes
            const hasQuizzes = course.sections.some(section => 
                section.lectures.some(lecture => lecture.type === 'quiz')
            );

            let quizAverageScore = 100; // Default if no quizzes

            if (hasQuizzes && progress.quizScores && progress.quizScores.length > 0) {
                const totalScore = progress.quizScores.reduce((sum, score) => sum + score.score, 0);
                quizAverageScore = totalScore / progress.quizScores.length;

                const requiredScore = course.certificate.passingScore || 70;
                if (quizAverageScore < requiredScore) {
                    return {
                        eligible: false,
                        reason: `Minimum quiz score required: ${requiredScore}%. Current average: ${quizAverageScore.toFixed(1)}%`
                    };
                }
            }

            return {
                eligible: true,
                data: {
                    completionPercentage,
                    quizAverageScore,
                    completedAt: progress.completedAt || new Date(),
                    totalDuration: course.totalDuration,
                    completionTime: progress.completionTime
                }
            };
        } catch (error) {
            console.error('Check eligibility error:', error);
            throw error;
        }
    }

    /**
     * Generate certificate for eligible user
     * @param {string} userId - User ID
     * @param {string} courseId - Course ID
     * @param {Object} options - Additional options
     * @returns {Object} Generated certificate
     */
    async generateCertificate(userId, courseId, options = {}) {
        try {
            // Check eligibility first
            const eligibilityResult = await this.checkEligibility(userId, courseId);
            
            if (!eligibilityResult.eligible) {
                throw new Error(eligibilityResult.reason);
            }

            // Get course and user data
            const course = await Course.findById(courseId).populate('instructor', 'name');
            const User = require('../models/User');
            const user = await User.findById(userId);

            if (!course || !user) {
                throw new Error('Course or user not found');
            }

            // Determine grade based on completion and quiz scores
            const grade = this.calculateGrade(
                eligibilityResult.data.completionPercentage,
                eligibilityResult.data.quizAverageScore
            );

            // Create certificate with course-specific configuration
            const certificate = new Certificate({
                user: userId,
                course: courseId,
                completedAt: eligibilityResult.data.completedAt,
                grade,
                skills: course.tags || [],
                certificateData: {
                    organizationName: course.certificate.organizationName || 'Online Learning Platform',
                    logoUrl: course.certificate.logo?.url,
                    signedBy: {
                        name: course.certificate.signedBy.name || course.instructor.name,
                        title: course.certificate.signedBy.title || 'Course Instructor',
                        signatureUrl: course.certificate.signedBy.signature?.url
                    },
                    template: course.certificate.template || 'modern'
                },
                metadata: {
                    totalDuration: eligibilityResult.data.totalDuration,
                    completionTime: eligibilityResult.data.completionTime,
                    finalScore: eligibilityResult.data.quizAverageScore,
                    completionPercentage: eligibilityResult.data.completionPercentage,
                    quizAverageScore: eligibilityResult.data.quizAverageScore
                }
            });

            await certificate.save();

            // Update enrollment to mark as completed
            await Enrollment.findOneAndUpdate(
                { user: userId, course: courseId },
                { 
                    completedAt: new Date(),
                    hasCertificate: true
                }
            );

            return {
                success: true,
                certificate: await Certificate.findById(certificate._id)
                    .populate('user', 'name email')
                    .populate('course', 'title instructor category')
            };
        } catch (error) {
            console.error('Generate certificate error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Calculate grade based on completion and quiz performance
     * @param {number} completionPercentage 
     * @param {number} quizAverageScore 
     * @returns {string} Grade
     */
    calculateGrade(completionPercentage, quizAverageScore) {
        const overallScore = (completionPercentage + quizAverageScore) / 2;

        if (overallScore >= 95) return 'A+';
        if (overallScore >= 90) return 'A';
        if (overallScore >= 85) return 'B+';
        if (overallScore >= 80) return 'B';
        if (overallScore >= 75) return 'C+';
        if (overallScore >= 70) return 'C';
        return 'Pass';
    }

    /**
     * Verify certificate authenticity
     * @param {string} certificateId 
     * @returns {Object} Verification result
     */
    async verifyCertificate(certificateId) {
        try {
            const certificate = await Certificate.findOne({ certificateId })
                .populate('user', 'name email')
                .populate('course', 'title instructor category');

            if (!certificate) {
                return {
                    valid: false,
                    message: 'Certificate not found'
                };
            }

            return {
                valid: true,
                certificate: {
                    id: certificate.certificateId,
                    student: certificate.user.name,
                    course: certificate.course.title,
                    issuedAt: certificate.issuedAt,
                    completedAt: certificate.completedAt,
                    grade: certificate.grade,
                    organizationName: certificate.certificateData.organizationName,
                    signedBy: certificate.certificateData.signedBy.name
                }
            };
        } catch (error) {
            console.error('Verify certificate error:', error);
            return {
                valid: false,
                message: 'Verification failed'
            };
        }
    }

    /**
     * Get certificate HTML template for rendering
     * @param {Object} certificate 
     * @returns {string} HTML template
     */
    generateCertificateHTML(certificate) {
        const template = certificate.certificateData.template || 'modern';
        
        const baseHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Certificate of Completion</title>
            <style>
                body { font-family: 'Georgia', serif; margin: 0; padding: 20px; }
                .certificate { 
                    max-width: 800px; 
                    margin: 0 auto; 
                    border: 10px solid #2c3e50; 
                    padding: 40px;
                    text-align: center;
                    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                }
                .logo { max-height: 80px; margin-bottom: 20px; }
                .title { font-size: 36px; color: #2c3e50; margin-bottom: 30px; font-weight: bold; }
                .subtitle { font-size: 18px; color: #7f8c8d; margin-bottom: 40px; }
                .student-name { font-size: 32px; color: #e74c3c; margin: 20px 0; font-weight: bold; }
                .course-name { font-size: 24px; color: #3498db; margin: 20px 0; }
                .completion-date { font-size: 16px; color: #7f8c8d; margin: 20px 0; }
                .signature { margin-top: 40px; }
                .signature-line { border-top: 2px solid #2c3e50; width: 200px; margin: 20px auto 5px; }
                .signature-name { font-size: 16px; font-weight: bold; }
                .signature-title { font-size: 14px; color: #7f8c8d; }
                .certificate-id { font-size: 12px; color: #95a5a6; margin-top: 30px; }
            </style>
        </head>
        <body>
            <div class="certificate">
                ${certificate.certificateData.logoUrl ? `<img src="${certificate.certificateData.logoUrl}" class="logo" alt="Organization Logo">` : ''}
                <div class="title">Certificate of Completion</div>
                <div class="subtitle">This is to certify that</div>
                <div class="student-name">${certificate.user.name}</div>
                <div class="subtitle">has successfully completed the course</div>
                <div class="course-name">"${certificate.course.title}"</div>
                <div class="completion-date">
                    Completed on ${new Date(certificate.completedAt).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}
                </div>
                <div class="completion-date">
                    Grade: ${certificate.grade} | 
                    Completion: ${certificate.metadata.completionPercentage}%
                    ${certificate.metadata.quizAverageScore ? ` | Quiz Average: ${certificate.metadata.quizAverageScore.toFixed(1)}%` : ''}
                </div>
                
                <div class="signature">
                    ${certificate.certificateData.signedBy.signatureUrl ? 
                        `<img src="${certificate.certificateData.signedBy.signatureUrl}" alt="Signature" style="max-height: 60px;">` : 
                        '<div style="height: 60px;"></div>'
                    }
                    <div class="signature-line"></div>
                    <div class="signature-name">${certificate.certificateData.signedBy.name}</div>
                    <div class="signature-title">${certificate.certificateData.signedBy.title}</div>
                </div>
                
                <div class="certificate-id">
                    Certificate ID: ${certificate.certificateId}<br>
                    Issued by: ${certificate.certificateData.organizationName}
                </div>
            </div>
        </body>
        </html>
        `;

        return baseHTML;
    }
}

module.exports = CertificateService;