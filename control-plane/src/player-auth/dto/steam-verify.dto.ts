import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class SteamVerifyDto {
  @IsString()
  @Matches(/^c[a-z0-9]{10,40}$/i, { message: 'Valid server required' })
  serverInstanceId!: string;

  @IsString()
  @MaxLength(2048)
  returnTo!: string;

  @IsObject()
  openid!: Record<string, unknown>;
}
