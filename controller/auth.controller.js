const User = require('../models/User')
const Wallet = require('../models/Wallet')
const {
  generateVerificationOTP,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
} = require('../utils/email')
const { generateToken } = require('../utils/jwt')
const { handleError } = require('../utils/utils')
const { validateAndSanitize } = require('../middleware/validation')
const crypto = require('crypto')

const RegisterWithEmailVerification = async (req, res, next) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ 
      message: 'Email is required',
      code: 'EMAIL_REQUIRED' 
    })
  }

  try {
    // Check if email already exists and is verified
    const existingUser = await User.findOne({ email })
    
    if (existingUser) {
      if (existingUser.email_verification.is_verified) {
        return res.status(400).json({ 
          message: 'Email already registered',
          code: 'EMAIL_EXISTS' 
        })
      } else {
        // Email exists but not verified - we can reuse this account
        // Check if we can resend (rate limiting)
        const lastSent = existingUser.email_verification.verification_sent_at
        if (lastSent && new Date() - lastSent < 60000) { // 1 minute cooldown
          return res.status(429).json({
            message: 'Please wait before requesting another verification code',
            code: 'RATE_LIMITED',
          })
        }

        // Generate new OTP
        const verificationOTP = generateVerificationOTP()
        const verificationExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

        existingUser.email_verification.verification_otp = verificationOTP
        existingUser.email_verification.verification_otp_expires = verificationExpires
        existingUser.email_verification.verification_sent_at = new Date()
        await existingUser.save()

        // Send verification email
        const emailResult = await sendVerificationEmail(
          email,
          email.split('@')[0], // Temporary username for email template
          verificationOTP
        )

        if (!emailResult.success) {
          return res.status(500).json({ 
            message: 'Failed to send verification email',
            code: 'EMAIL_SEND_FAILED'
          })
        }

        return res.status(200).json({
          message: 'Verification code sent to your email',
          email: email,
          step: 'verify_email',
          exists: true,
          otp_expires_in: '10 minutes'
        })
      }
    }

    // New email - create a temporary user account
    const verificationOTP = generateVerificationOTP()
    const verificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Create a temporary user with just email
    const tempUser = new User({
      email,
      username: `temp_${Date.now()}`, // Temporary username
      password: crypto.randomBytes(16).toString('hex'), // Random password
      email_verification: {
        is_verified: false,
        verification_otp: verificationOTP,
        verification_otp_expires: verificationOTPExpires,
        verification_sent_at: new Date(),
      },
      is_temp_account: true, // Flag for temporary account
    })

    await tempUser.save()

    // Send verification email
    const emailResult = await sendVerificationEmail(
      email,
      email.split('@')[0], // Temporary username for email template
      verificationOTP
    )

    if (!emailResult.success) {
      return res.status(500).json({ 
        message: 'Failed to send verification email',
        code: 'EMAIL_SEND_FAILED' 
      })
    }

    res.status(200).json({
      message: 'Verification code sent to your email',
      email: email,
      step: 'verify_email',
      otp_expires_in: '10 minutes'
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const completeRegistration = async (req, res, next) => {
  console.log("completeRegistration called");
  try {
    const {email,username,password}=req.body
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    const user=await User.findOne({email})
    if(!user){
      return res.status(400).json({ message: 'No user found' })
    }
    if(!user.email_verification.is_verified){
      return res.status(400).json({ message: 'Email is not verified' })
    }
    // Check if username already exists
     const existingUsername = await User.findOne({ 
      username, 
      _id: { $ne: user._id } 
    })   
     if (existingUsername) {
      return res.status(400).json({ 
        message: 'Username already taken',
        code: 'USERNAME_EXISTS' 
      })
    }
    const customName = username
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 50)
      .trim()
    user.username=username
    user.password=password
    user.is_temp_account=false
    user.custom_name=customName
    await user.save()
    const existingWallet = await Wallet.findOne({ user_id: user._id })
    if (!existingWallet) {
      const newWallet = new Wallet({
        user_id: user._id,
        balance: 0,
        currency: 'INR',
        wallet_type: 'user',
        status: 'active',
        total_loaded: 0,
      })
      await newWallet.save()
    }
     const token = generateToken(user._id)
     await sendWelcomeEmail(user.email, user.username)

      res.status(201).json({
      message: 'Registration completed successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        email_verified: true,
      }
    })  
  } catch (error) {
    handleError(error, req, res, next)
  }
}


const LongVideo = require('../models/LongVideo')
const RegisterNewUser = async (req, res, next) => {
  const { email, password, username } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: 'All fields are required' })
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ email: email }, { username: username }],
    })

    if (existingUser) {
      if (existingUser.email === email) {
        return res
          .status(400)
          .json({ message: 'User already exists', code: 'EMAIL_EXISTS' })
      } else {
        return res.status(400).json({
          message: 'User already exists',
          code: 'USERNAME_EXISTS',
        })
      }
    }
    //generate a verification OTP
    const verificationOTP = generateVerificationOTP()
    const verificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // generate a custom name based on username
    const customName = username
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 50)
      .trim()

    const newUser = new User({
      username,
      custom_name: customName,
      email,
      password,
      email_verification: {
        is_verified: false,
        verification_otp: verificationOTP,
        verification_otp_expires: verificationOTPExpires,
        verification_sent_at: new Date(),
      },
    })

    await newUser.save()

    const newWallet = new Wallet({
      user_id: newUser._id,
      balance: 0,
      currency: 'INR',
      wallet_type: 'user',
      status: 'active',
      total_loaded: 0,
    })
    await newWallet.save()

    const emailResult = await sendVerificationEmail(
      email,
      username,
      verificationOTP
    )
    if (!emailResult.success) {
      return res
        .status(500)
        .json({ message: 'Failed to send verification email' })
    }
    const token = generateToken(newUser._id)

    res.status(201).json({
      message:
        'User registered successfully. Please check your email for the 6-digit verification code',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        email_verified: false,
      },
      verification: {
        email_sent: emailResult.success,
        message: emailResult.success
          ? 'Verification OTP sent successfully'
          : 'Registration completed but verification email failed to send',
        otp_expires_in: '10 minutes',
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const verifyEmail = async (req, res, next) => {
  const { otp } = req.body

  if (!otp) {
    return res.status(400).json({ message: 'Verification OTP is required' })
  }

  // Validate OTP format
  const otpValidation = validateAndSanitize.otp(otp)
  if (!otpValidation.isValid) {
    return res.status(400).json({
      message: otpValidation.error,
      code: 'INVALID_OTP_FORMAT',
    })
  }

  try {
      const user = await User.findOne({
      'email_verification.verification_otp': otp,
      'email_verification.verification_otp_expires': { $gt: new Date() }
    })

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired verification OTP',
        code: 'INVALID_OTP',
      })
    }

    if (user.email_verification.is_verified) {
      return res.status(400).json({
        message: 'Email is already verified',
        code: 'ALREADY_VERIFIED',
      })
    }

    user.email_verification.is_verified = true
    user.email_verification.verification_otp = null
    user.email_verification.verification_otp_expires = null
    await user.save()

    res.status(200).json({
      message: 'Email verified successfully! You can now sign in.',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        email_verified: true,
      },
      redirect: '/login',
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: 'Email is required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.email_verification.is_verified) {
      return res.status(400).json({
        message: 'Email is already verified',
        code: 'ALREADY_VERIFIED',
      })
    }

    // Check if we can resend (rate limiting)
    const lastSent = user.email_verification.verification_sent_at
    if (lastSent && new Date() - lastSent < 60000) {
      // 1 minute cooldown
      return res.status(429).json({
        message: 'Please wait before requesting another verification OTP',
        code: 'RATE_LIMITED',
      })
    }

    // Generate new OTP
    const verificationOTP = generateVerificationOTP()
    const verificationExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    user.email_verification.verification_otp = verificationOTP
    user.email_verification.verification_otp_expires = verificationExpires
    user.email_verification.verification_sent_at = new Date()
    await user.save()

    // Send verification email
    const emailResult = await sendVerificationEmail(
      user.email,
      user.username,
      verificationOTP
    )

    if (!emailResult.success) {
      return res.status(500).json({
        message: 'Failed to send verification email',
        code: 'EMAIL_SEND_FAILED',
      })
    }

    res.status(200).json({
      message: 'Verification OTP sent successfully',
      email_sent: true,
      otp_expires_in: '10 minutes',
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const LoginUserWithEmail = async (req, res, next) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }

  try {
    const user = await User.findOne({ email }).select('+password')
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }
    if (!user.email_verification.is_verified) {
      return res.status(403).json({
        message: 'Please verify your email before signing in',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        can_resend: true,
      })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const token = generateToken(user._id)
    if (user.isDeactivated()) {
      console.log('Reactivating deactivated user:', user._id)

      await user.reactivateAccount()
      await LongVideo.updateMany(
        {
          created_by: user._id,
          hidden_reason: 'account_deactivated',
        },
        {
          $set: { visibility: 'public' },
          $unset: {
            hidden_reason: 1,
            hidden_at: 1,
          },
        }
      )
      console.log(`Account reactivated for user: ${user.username}`)
    }

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        is_onboarded: user.onboarding_completed,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const LoginUserWithUsername = async (req, res, next) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: 'Username and password are required' })
  }

  try {
    const user = await User.findOne({ username }).select('+password')
    if (!user) {
      return res.status(400).json({ message: 'Invalid username or password' })
    }
    if (!user.email_verification.is_verified) {
      return res.status(403).json({
        message: 'Please verify your email before signing in',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        can_resend: true,
      })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid username or password' })
    }

    const token = generateToken(user._id)

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isCommentMonetizationEnabled: user.isCommentMonetizationEnabled,
        upiId:user.creator_profile?.upi_id || null,
        is_onboarded: user.onboarding_completed,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const RegisterUserWithGoogle = async (req, res, next) => {
  const { email, picture } = req.googleUser
  if (!email) {
    return res.status(401).json({ message: 'Malformed google Id-token' })
  }

  try {
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' })
    }

    let username = await User.findOne({ username: email.split('@')[0] })
    if (!username) {
      username = email.split('@')[0]
    } else {
      username = username.username + Math.floor(Math.random() * 100000)
    }

    const newUser = new User({
      username,
      email,
      is_google_user: true,
    })

    if (picture) {
      newUser.profile_photo = picture
    }

    await newUser.save()

    // Create wallet for the Google user
    const newWallet = new Wallet({
      user_id: newUser._id,
      balance: 0,
      currency: 'INR',
      wallet_type: 'user',
      status: 'active',
      total_loaded: 0,
    })
    await newWallet.save()

    const token = generateToken(newUser._id)

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const LoginUserWithGoogle = async (req, res, next) => {
  const { email } = req.googleUser

  if (!email) {
    return res.status(400).json({ message: 'Malformed google Id-token' })
  }

  try {
    const user = await User.findOne({ email }).select('+is_google_user')
    if (!user) {
      return res.status(400).json({ message: 'Invalid email' })
    }

    if (!user.is_google_user) {
      return res
        .status(400)
        .json({ message: 'Email is not linked with a google account' })
    }

    const token = generateToken(user._id)

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        is_onboarded: user.onboarding_completed,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const LogoutUser = (req, res) => {
  // Remove the token on the client side
  res.status(200).json({ message: 'User logged out successfully' })
}

const RefreshToken = async (req, res, next) => {
  try {
    const token = generateToken(req.user.id)

    res.status(200).json({
      message: 'Token refreshed successfully',
      token,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
      },
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: 'Email is required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.status(200).json({
        message:
          'If an account with that email exists, we have sent a password reset link.',
        email_sent: true,
      })
    }

    // Check if we can send reset email (rate limiting)
    const lastReset = user.password_reset.reset_requested_at
    if (lastReset && new Date() - lastReset < 300000) {
      // 5 minutes cooldown
      return res.status(429).json({
        message: 'Please wait before requesting another password reset email',
        code: 'RATE_LIMITED',
      })
    }

    // Generate reset token
    const reset_otp = generatePasswordResetOTP()
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    user.password_reset.reset_otp = reset_otp
    user.password_reset.reset_otp_expires = resetExpires
    user.password_reset.reset_requested_at = new Date()
    await user.save()

    // Send reset email
    const emailResult = await sendPasswordResetEmail(
      user.email,
      user.username,
      reset_otp
    )

    if (!emailResult.success) {
      // Reset the token if email fails
      user.password_reset.reset_otp = null
      user.password_reset.reset_otp_expires = null
      await user.save()

      return res.status(500).json({
        message: 'Failed to send password reset email',
        code: 'EMAIL_SEND_FAILED',
      })
    }

    res.status(200).json({
      message: 'Password reset email sent successfully',
      email_sent: true,
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const verifyResetToken = async (req, res, next) => {
  try {
    const { otp } = req.body

    if (!otp) {
      return res.status(400).json({
        message: 'Reset otp is required',
        code: 'TOKEN_REQUIRED',
      })
    }

    const otpValidation = validateAndSanitize.otp(otp)
    if (!otpValidation.isValid) {
      return res.status(400).json({
        message: otpValidation.error,
        code: 'INVALID_OTP_FORMAT',
      })
    }

    const user = await User.findOne({
      'password_reset.reset_otp': otp,
      'password_reset.reset_otp_expires': { $gt: new Date() },
    })

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired reset otp',
        code: 'INVALID_TOKEN',
      })
    }

    res.status(200).json({
      message: 'Reset otp is valid',
      valid: true,
      email: user.email,
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const resetPassword = async (req, res, next) => {
  try {
    const { otp, newPassword, confirmPassword } = req.body

    if (!otp || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: 'Token, new password, and password confirmation are required',
      })
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: 'Passwords do not match',
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long',
      })
    }

    const user = await User.findOne({
      'password_reset.reset_otp': otp,
      'password_reset.reset_otp_expires': { $gt: new Date() },
    }).select('+password')

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired reset otp',
        code: 'INVALID_TOKEN',
      })
    }

    // Check if new password is different from current password
    const isSamePassword = await user.comparePassword(newPassword)
    if (isSamePassword) {
      return res.status(400).json({
        message: 'New password must be different from your current password',
      })
    }

    // Update password and clear reset token
    user.password = newPassword
    user.password_reset.reset_otp = null
    user.password_reset.reset_otp_expires = null
    user.password_reset.reset_requested_at = null
    await user.save()

    // Send confirmation email
    await sendPasswordResetConfirmationEmail(user.email, user.username)

    res.status(200).json({
      message:
        'Password reset successfully. You can now sign in with your new password.',
      success: true,
      redirect: '/login',
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const checkUsernameExists = async (req, res, next) => {
  const { username } = req.params
  if (!username) {
    return res.status(400).json({ message: 'Username is required' })
  }
  try {
    const user = await User.findOne({ username })
    if (user) {
      return res.status(200).json({
        exists: true,
        message: 'Username already exists',
      })
    }
    res.status(200).json({
      exists: false,
      message: 'Username is available',
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const checkEmailExists = async (req, res, next) => {
  const { email } = req.params
  if (!email) {
    return res.status(400).json({ message: 'Email is required' })
  }
  try {
    const user = await User.findOne({ email })
    if (user) {
      return res.status(200).json({
        exists: true,
        message: 'Email already exists',
      })
    }
    res.status(200).json({
      exists: false,
      message: 'Email is available',
    })
  } catch (error) {
    handleError(error, req, res, next)
  }
}

const generatePasswordResetOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString() // 6-digit OTP
}

module.exports = {
  RegisterNewUser,
      RefreshToken,
  LoginUserWithEmail,
  LoginUserWithUsername,
  LogoutUser,
  RefreshToken,
  RegisterUserWithGoogle,
  LoginUserWithGoogle,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  checkUsernameExists,
  checkEmailExists,
  RegisterWithEmailVerification,
  completeRegistration,
}
