import {Body,Controller,Post,UseGuards,Param,Req} from '@nestjs/common';
import {IsString,MaxLength,MinLength} from 'class-validator';
import {JwtAuthGuard,RequestWithUser} from '../server-instances/guards/jwt-auth.guard';
import {OrgMemberGuard} from '../server-instances/guards/org-member.guard';
import {RequireOrgRoleGuard,RequireOrgRoles} from '../server-instances/guards/require-org-role.guard';
import {ModAiService} from './mod-ai.service';
class EditModDto{@IsString()@MinLength(1)@MaxLength(128) modName!:string;@IsString()@MinLength(1)@MaxLength(512) path!:string;@IsString()@MaxLength(65536) content!:string;@IsString()@MinLength(2)@MaxLength(4000) instruction!:string;}
@Controller('api/orgs/:orgId/mod-ai')
@UseGuards(JwtAuthGuard,OrgMemberGuard,RequireOrgRoleGuard)
@RequireOrgRoles('admin','operator')
export class ModAiController{constructor(private readonly service:ModAiService){}@Post('edit')edit(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:EditModDto){return this.service.edit(orgId,req.user!.id,dto);}}
