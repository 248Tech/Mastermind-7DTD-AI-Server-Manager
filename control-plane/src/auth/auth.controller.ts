import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { clientIp } from '../common/client-ip';

type ClientRequest = { ip?: string; headers?: Record<string, string | string[] | undefined> };

class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(20)
  mathChallengeToken!: string;

  @IsString()
  @MaxLength(16)
  mathAnswer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  recaptchaToken?: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
class VerifyEmailDto { @IsString() @MinLength(20) token!: string; }
class ResendVerificationDto { @IsEmail() @MaxLength(254) email!: string; }

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly rateLimit: AuthRateLimitService) {}

  /** Register a new user account. */
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: ClientRequest) {
    const ip = clientIp(req);
    await this.rateLimit.consumeRegistration(ip);
    return this.authService.register(dto.email, dto.password, dto.name, ip);
  }

  /** Login with email + password. Returns JWT. */
  @Get('login-security')
  loginSecurity() { return this.authService.getLoginSecurity(); }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: ClientRequest) {
    return this.authService.login(dto.email, dto.password, clientIp(req), dto.mathChallengeToken, dto.mathAnswer, dto.recaptchaToken);
  }

  /** Get current user's profile and org memberships. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user!.id);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) { return this.authService.verifyEmail(dto.token); }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() req: ClientRequest) {
    await this.rateLimit.consumeVerificationResend(clientIp(req));
    return this.authService.resendVerification(dto.email);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() req: RequestWithUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(req.user!.id, dto.currentPassword, dto.newPassword);
  }
}
