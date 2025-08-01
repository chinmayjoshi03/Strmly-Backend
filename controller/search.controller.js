const { handleError } = require('../utils/utils')
const User = require('../models/User')
const LongVideo = require('../models/LongVideo')
const Series = require('../models/Series')
const Community = require('../models/Community')
const { getRedisClient } = require('../config/redis')

const GlobalSearch = async (req, res, next) => {
  try {
    const { query, limit = 10, page = 1 } = req.query

    if (!query || query.trim() === '') {
      return res.status(400).json({ message: 'Search query is required' })
    }
     const redis = getRedisClient();
    const cacheKey = `global_search:${query}:${page}:${limit}`;
    
    if (redis) {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        console.log(`📦 Search cache HIT for query: ${query}`);
        return res.status(200).json({
          ...JSON.parse(cachedResult),
          cached: true
        });
      }
    }

    const searchRegex = new RegExp(query, 'i')
    const skip = (page - 1) * limit
    const limitNum = parseInt(limit)

    const [users, videos, series] = await Promise.all([
      User.find({
        $or: [{ username: searchRegex }, { email: searchRegex }],
      })
        .select('username email profile_photo followers following')
        .limit(limitNum)
        .skip(skip),

      LongVideo.find({
        $or: [{ name: searchRegex }, { description: searchRegex }],
      })
        .populate('created_by', 'username profile_photo')
        .populate('series', 'title')
        .limit(limitNum)
        .skip(skip),

      Series.find({
        $or: [
          { title: searchRegex },
          { description: searchRegex },
          { genre: searchRegex },
          { language: searchRegex },
        ],
      })
        .populate('created_by', 'username profile_photo')
        .limit(limitNum)
        .skip(skip),
    ])

    const totalResults = users.length + videos.length + series.length

     const result = {
      message: 'Search completed successfully',
      query,
      totalResults,
      results: {
        users,
        videos,
        series,
      },
      pagination: {
        currentPage: parseInt(page),
        limit: limitNum,
        hasMore: totalResults === limitNum * 3,
      },
      cached: false
    };

    // Cache the result for 5 minutes
    if (redis && totalResults > 0) {
      await redis.setex(cacheKey, 300, JSON.stringify(result));
      console.log(`💾 Search results cached for query: ${query}`);
    }

    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const searchFollowersOrFollowing = async (req, res, next) => {
  try {
    const { query, type, limit = 10, page = 1 } = req.query
    const userId = req.user.id

    if (!query || query.trim() === '') {
      return res.status(400).json({ message: 'Search query is required' })
    }

    if (!type || !['followers', 'following'].includes(type)) {
      return res.status(400).json({
        message:
          'Type is required and must be either "followers" or "following"',
      })
    }

    const redis = getRedisClient();
    const cacheKey = `search_connections:${userId}:${type}:${query}:${page}:${limit}`;
    
    if (redis) {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        return res.status(200).json({
          ...JSON.parse(cachedResult),
          cached: true
        });
      }
    }

    const searchRegex = new RegExp(query, 'i')
    const skip = (page - 1) * limit
    const limitNum = parseInt(limit)

    const user = await User.findById(userId)
      .populate('followers', 'username profile_photo email')
      .populate('following', 'username profile_photo email')

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    let allUsers = []
    let totalCount = 0

    if (type === 'followers') {
      allUsers = user.followers.filter(
        (follower) =>
          follower.username.match(searchRegex) ||
          (follower.email && follower.email.match(searchRegex))
      )
      totalCount = allUsers.length
      allUsers = allUsers.slice(skip, skip + limitNum)
    } else if (type === 'following') {
      allUsers = user.following.filter(
        (following) =>
          following.username.match(searchRegex) ||
          (following.email && following.email.match(searchRegex))
      )
      totalCount = allUsers.length
      allUsers = allUsers.slice(skip, skip + limitNum)
    }

    const result = {
      message: 'Search completed successfully',
      query,
      type,
      totalResults: totalCount,
      results: {
        users: allUsers,
      },
      pagination: {
        currentPage: parseInt(page),
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        hasMore: skip + limitNum < totalCount,
      },
      cached: false
    };

    if (redis) {
      await redis.setex(cacheKey, 300, JSON.stringify(result));
    }

    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const PersonalizedSearch = async (req, res, next) => {
  try {
    const { query, limit = 10, page = 1 } = req.query
    const userId = req.user.id

    if (!query || query.trim() === '') {
      return res.status(400).json({ message: 'Search query is required' })
    }

    const user = await User.findById(userId)
      .populate('saved_videos')
      .populate('saved_series')
      .populate('following')

    const searchRegex = new RegExp(query, 'i')
    const skip = (page - 1) * limit
    const limitNum = parseInt(limit)

    const userGenres = []
    if (user.saved_series.length > 0) {
      user.saved_series.forEach((series) => {
        if (series.genre && !userGenres.includes(series.genre)) {
          userGenres.push(series.genre)
        }
      })
    }

    let videoQuery = {
      $or: [{ name: searchRegex }, { description: searchRegex }],
    }

    let seriesQuery = {
      $or: [
        { title: searchRegex },
        { description: searchRegex },
        { genre: searchRegex },
        { language: searchRegex },
      ],
    }

    const followingIds = user.following.map((f) => f._id)
    if (followingIds.length > 0) {
      videoQuery.$or.push({ created_by: { $in: followingIds } })
      seriesQuery.$or.push({ created_by: { $in: followingIds } })
    }

    if (userGenres.length > 0) {
      seriesQuery.$or.push({ genre: { $in: userGenres } })
    }

    const [videos, series] = await Promise.all([
      LongVideo.find(videoQuery)
        .populate('created_by', 'username profile_photo')
        .populate('series', 'title')
        .sort({ views: -1, likes: -1 })
        .limit(limitNum)
        .skip(skip),

      Series.find(seriesQuery)
        .populate('created_by', 'username profile_photo')
        .sort({ views: -1, likes: -1 })
        .limit(limitNum)
        .skip(skip),

 
    ])

    const totalResults = videos.length + series.length  

    res.status(200).json({
      message: 'Personalized search completed successfully',
      query,
      totalResults,
      results: {
        videos,
        series,
     
      },
      userPreferences: {
        favoriteGenres: userGenres,
        followingCount: followingIds.length,
      },
      pagination: {
        currentPage: parseInt(page),
        limit: limitNum,
        hasMore: totalResults === limitNum * 3,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const GetContentByType = async (req, res, next) => {
  try {
    const {
      type,
      limit = 10,
      page = 1,
      genre,
      language,
      sortBy = 'createdAt',
    } = req.query

    if (!type) {
      return res.status(400).json({
        message: 'Content type is required (videos, series, users)',
      })
    }

    const validTypes = ['videos', 'series', 'users']
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message:
          'Invalid content type. Valid types are: videos, series,users',
      })
    }

    const redis = getRedisClient();
    const cacheKey = `content_by_type:${type}:${genre || 'all'}:${language || 'all'}:${sortBy}:${page}:${limit}`;
    
    if (redis) {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        return res.status(200).json({
          ...JSON.parse(cachedResult),
          cached: true
        });
      }
    }

    const skip = (page - 1) * limit
    const limitNum = parseInt(limit)

    let sortObject
    switch (sortBy) {
      case 'popular':
        sortObject = { views: -1, likes: -1 }
        break
      case 'newest':
        sortObject = { createdAt: -1 }
        break
      case 'oldest':
        sortObject = { createdAt: 1 }
        break
      case 'likes':
        sortObject = { likes: -1 }
        break
      case 'views':
        sortObject = { views: -1 }
        break
      default:
        sortObject = { createdAt: -1 }
    }

    let totalCount = 0
    let results

    switch (type) {
      case 'videos': {
        let videoQuery = {}
        if (genre) videoQuery['series.genre'] = genre

        results = await LongVideo.find(videoQuery)
          .populate('created_by', 'username profile_photo')
          .populate('series', 'title genre')
          .sort(sortObject)
          .limit(limitNum)
          .skip(skip)

        totalCount = await LongVideo.countDocuments(videoQuery)
        break
      }

      case 'series': {
        let seriesQuery = {}
        if (genre) seriesQuery.genre = genre
        if (language) seriesQuery.language = new RegExp(language, 'i')

        results = await Series.find(seriesQuery)
          .populate('created_by', 'username profile_photo')
          .sort(sortObject)
          .limit(limitNum)
          .skip(skip)

        totalCount = await Series.countDocuments(seriesQuery)
        break
      }

      case 'users': {
        let userSortObject = {}
        if (sortBy === 'popular') {
          userSortObject = { followers: -1 }
        } else {
          userSortObject = { createdAt: -1 }
        }

        results = await User.find({})
          .select('username email profile_photo followers following createdAt')
          .sort(userSortObject)
          .limit(limitNum)
          .skip(skip)

        totalCount = await User.countDocuments({})
        break
      }
    }

    const totalPages = Math.ceil(totalCount / limitNum)

    const result = {
      message: `${type} content retrieved successfully`,
      type,
      filters: {
        genre: genre || null,
        language: language || null,
        sortBy,
      },
      results,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: limitNum,
        hasMore: parseInt(page) < totalPages,
      },
      cached: false
    };

    // Cache for 10 minutes
    if (redis) {
      await redis.setex(cacheKey, 600, JSON.stringify(result));
    }

    res.status(200).json(result);
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const GetTopCommunities = async (req, res, next) => {
  try {
    const communities = await Community.find({})
      .populate('followers', 'username profile_photo')
      .populate('creators', 'username profile_photo')
      .sort({ createdAt: -1 })
      .limit(25)

    res.status(200).json({
      message: 'Top communities retrieved successfully',
      communities,
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

module.exports = {
  GlobalSearch,
  PersonalizedSearch,
  GetContentByType,
  GetTopCommunities,
  searchFollowersOrFollowing,
}
