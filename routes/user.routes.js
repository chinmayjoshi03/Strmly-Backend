const router = require('express').Router()
const { authenticateToken } = require('../middleware/auth')
const {
  GetUserFeed,
  GetUserProfile,
  UpdateUserProfile,
  GetUserCommunities,
  GetUserVideos,
  GetUserInteractions,
  GetUserEarnings,
  GetUserNotifications,
  UpdateUserInterests,
  GetUserFollowers,
  GetUserFollowing,
  getUserProfileDetails,
  GetUserProfileById,
  GetUserVideosById,
  SetCreatorPassPrice,
  HasCreatorPass,
  followUser,
  unfollowUser,
  getUserHistory,
  getUserLikedVideosInCommunity,
  updateSocialMediaLinks,
  getUserDashboardAnalytics,
  getUserPurchasedAccess,
  toggleCommentMonetization,
  saveUserFCMToken,
} = require('../controller/user.controller')
const { createImageMulter, handleMulterError } = require('../utils/utils')

// Get user feed
router.get('/feed', authenticateToken, GetUserFeed)

// Get user profile
router.get('/profile', authenticateToken, GetUserProfile)

// Update user profile
router.put(
  '/profile',
  authenticateToken,
  createImageMulter().single('profile_photo'),
  UpdateUserProfile,
  handleMulterError
)

router.get('/dashboard', authenticateToken, getUserDashboardAnalytics)

//gets the videos, series and creator pass data which the user has purchased
router.get('/purchased-access', authenticateToken, getUserPurchasedAccess)

//enable/disable comment monetization
router.put(
  '/toggle-comment-monetization',
  authenticateToken,
  toggleCommentMonetization
)

//send firebase FCM token for the user
router.post('/fcm_token', authenticateToken, saveUserFCMToken)

// Get user communities
router.get('/communities', authenticateToken, GetUserCommunities)

// Get user videos
router.get('/videos', authenticateToken, GetUserVideos)

// Get user interactions
router.get('/interactions', authenticateToken, GetUserInteractions)

// Get user earnings
router.get('/earnings', authenticateToken, GetUserEarnings)

// Get user notifications
router.get('/notifications', authenticateToken, GetUserNotifications)

// Update user interests
router.put('/interests', authenticateToken, UpdateUserInterests)

// Get all user followers
router.get('/followers', authenticateToken, GetUserFollowers)

// Get all user following
router.get('/following', authenticateToken, GetUserFollowing)

// Get user profile details
router.get('/profile-details', authenticateToken, getUserProfileDetails)

// Get user profile by ID
router.get('/profile/:id', authenticateToken, GetUserProfileById)

// Get user videos by ID
router.get('/videos/:id', authenticateToken, GetUserVideosById)

// Set creator pass price
router.put('/creator-pass-price', authenticateToken, SetCreatorPassPrice)

// Check creator pass deletion status
router.get(
  '/creator-pass-deletion-status',
  authenticateToken,
  (req, res, next) => {
    // Redirect to creator pass routes
    req.url = '/deletion-status'
    next()
  }
)

// Check if user has creator pass for specific creator
router.get('/has-creator-pass/:creatorId', authenticateToken, HasCreatorPass)

// follow a user
router.post('/follow', authenticateToken, followUser)

// unfollow a user
router.post('/unfollow', authenticateToken, unfollowUser)

// Get user history
router.get('/history', authenticateToken, getUserHistory)

// Get user liked videos in a community
router.get(
  '/liked-videos-community',
  authenticateToken,
  getUserLikedVideosInCommunity
)

// Update social media links
router.put('/social-media-links', authenticateToken, updateSocialMediaLinks)

module.exports = router
