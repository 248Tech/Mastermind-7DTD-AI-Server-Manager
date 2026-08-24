import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { MAX_DONATION_CENTS, MIN_DONATION_CENTS } from '../donations.logic';
import { MAX_CART_ITEMS } from '../donations.shop';

export class CreateCheckoutDto {
  @ValidateIf((body: CreateCheckoutDto) => !body.shopItemId && !body.shopItemIds?.length)
  @IsInt()
  @Min(MIN_DONATION_CENTS)
  @Max(MAX_DONATION_CENTS)
  amountCents?: number;

  @ValidateIf((body: CreateCheckoutDto) => !body.amountCents && !body.shopItemIds?.length)
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(40)
  shopItemId?: string;

  @ValidateIf((body: CreateCheckoutDto) => !body.amountCents && !body.shopItemId)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_ITEMS)
  @IsString({ each: true })
  @MinLength(10, { each: true })
  @MaxLength(40, { each: true })
  shopItemIds?: string[];
}
