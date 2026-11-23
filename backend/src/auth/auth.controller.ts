import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { UserEntity } from './entities/user.entity';

interface AuthenticatedRequest {
  user: { id: number; username: string };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<UserEntity> {
    return this.authService.register(dto);
  }

  /** Login with password validation (bcrypt compare, cost factor 12). */
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Refresh token rotation — returns a fresh access/refresh pair. */
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  /**
   * Revoke the current browser session. The refresh token is always
   * invalidated; the bearer token, when present, is blacklisted until its
   * natural expiry.
   */
  @Post('logout')
  @HttpCode(204)
  logout(
    @Body() dto: RefreshTokenDto,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    const accessToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    return this.authService.logout(dto.refresh_token, accessToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest): { id: number; username: string } {
    return { id: req.user.id, username: req.user.username };
  }
}
