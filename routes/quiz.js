const express = require('express');
const QuizAttempt = require('../models/QuizAttempt');
const Course = require('../models/Course');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Submit quiz attempt
router.post('/attempt', authenticateToken, async (req, res) => {
    try {
        const { courseId, lectureId, answers, timeTaken } = req.body;
        const userId = req.user._id;

        // Get the course and quiz data
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Find the quiz lecture
        let quizLecture = null;
        let lectureTitle = '';
        
        for (const section of course.sections) {
            const lecture = section.lectures.id(lectureId);
            if (lecture && lecture.type === 'quiz') {
                quizLecture = lecture;
                lectureTitle = lecture.title;
                break;
            }
        }

        if (!quizLecture) {
            return res.status(404).json({ message: 'Quiz not found' });
        }

        const quiz = quizLecture.quiz;
        const questions = quiz.questions;

        // Calculate score
        let correctAnswers = 0;
        const processedAnswers = answers.map((answer, index) => {
            const question = questions[index];
            const correctIndices = question.correctAnswers;
            const selectedIndices = answer.selectedAnswers;

            // Check if answer is correct
            let isCorrect = false;
            if (question.type === 'single') {
                // Single choice: exactly one correct answer
                isCorrect = selectedIndices.length === 1 && 
                          correctIndices.includes(selectedIndices[0]);
            } else {
                // Multiple choice: all correct answers must be selected, no incorrect ones
                isCorrect = correctIndices.length === selectedIndices.length &&
                          correctIndices.every(idx => selectedIndices.includes(idx)) &&
                          selectedIndices.every(idx => correctIndices.includes(idx));
            }

            if (isCorrect) correctAnswers++;

            return {
                questionIndex: index,
                selectedAnswers: selectedIndices,
                isCorrect
            };
        });

        const score = Math.round((correctAnswers / questions.length) * 100);
        const passed = quiz.isGraded ? score >= quiz.passingScore : null;

        // Create quiz attempt record
        const quizAttempt = new QuizAttempt({
            user: userId,
            course: courseId,
            lecture: lectureId,
            lectureTitle,
            answers: processedAnswers,
            score,
            totalQuestions: questions.length,
            correctAnswers,
            passed,
            passingScore: quiz.isGraded ? quiz.passingScore : null,
            isGraded: quiz.isGraded,
            timeTaken: timeTaken || 0
        });

        await quizAttempt.save();

        res.status(201).json({
            message: 'Quiz submitted successfully',
            attempt: quizAttempt,
            results: {
                score,
                correctAnswers,
                totalQuestions: questions.length,
                passed,
                isGraded: quiz.isGraded,
                passingScore: quiz.isGraded ? quiz.passingScore : null
            }
        });
    } catch (error) {
        console.error('Submit quiz attempt error:', error);
        res.status(500).json({ message: 'Failed to submit quiz attempt' });
    }
});

// Get quiz attempts for a user and lecture
router.get('/attempts/:courseId/:lectureId', authenticateToken, async (req, res) => {
    try {
        const { courseId, lectureId } = req.params;
        const userId = req.user._id;

        const attempts = await QuizAttempt.find({
            user: userId,
            course: courseId,
            lecture: lectureId
        }).sort({ createdAt: -1 });

        // Add attempt number to each attempt
        const attemptsWithNumber = attempts.map((attempt, index) => ({
            ...attempt.toObject(),
            attemptNumber: attempts.length - index
        }));

        res.json({
            attempts: attemptsWithNumber,
            totalAttempts: attempts.length,
            latestAttempt: attemptsWithNumber[0] || null
        });
    } catch (error) {
        console.error('Get quiz attempts error:', error);
        res.status(500).json({ message: 'Failed to get quiz attempts' });
    }
});

// Get quiz statistics for instructors
router.get('/stats/:courseId/:lectureId', authenticateToken, async (req, res) => {
    try {
        const { courseId, lectureId } = req.params;

        // Verify user is instructor of the course
        const course = await Course.findById(courseId);
        if (!course || course.instructor.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const attempts = await QuizAttempt.find({
            course: courseId,
            lecture: lectureId
        }).populate('user', 'name email').sort({ createdAt: -1 });

        // Calculate statistics
        const totalAttempts = attempts.length;
        const uniqueUsers = [...new Set(attempts.map(a => a.user._id.toString()))].length;
        const averageScore = totalAttempts > 0 ? 
            attempts.reduce((sum, a) => sum + a.score, 0) / totalAttempts : 0;
        
        const passRate = attempts.filter(a => a.isGraded).length > 0 ? 
            (attempts.filter(a => a.passed).length / attempts.filter(a => a.isGraded).length) * 100 : null;

        res.json({
            totalAttempts,
            uniqueUsers,
            averageScore: Math.round(averageScore * 100) / 100,
            passRate: passRate ? Math.round(passRate * 100) / 100 : null,
            attempts
        });
    } catch (error) {
        console.error('Get quiz stats error:', error);
        res.status(500).json({ message: 'Failed to get quiz statistics' });
    }
});

// Delete quiz attempts when quiz is deleted (called internally)
router.delete('/cleanup/:courseId/:lectureId', async (req, res) => {
    try {
        const { courseId, lectureId } = req.params;
        
        const result = await QuizAttempt.deleteMany({
            course: courseId,
            lecture: lectureId
        });

        console.log(`🗑️ Cleaned up ${result.deletedCount} quiz attempts for lecture ${lectureId}`);
        
        res.json({
            message: 'Quiz attempts cleaned up',
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Quiz cleanup error:', error);
        res.status(500).json({ message: 'Failed to cleanup quiz attempts' });
    }
});

module.exports = router;