import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssetsService } from './assets.service';
import { StorageService } from '../storage/storage.service';

@Controller('tiles')
export class TilesController {
  constructor(
    private readonly assets: AssetsService,
    private readonly storage: StorageService,
  ) {}

  @Get(':assetId/:z/:x/:y')
  async fetchTile(
    @Param('assetId') assetId: string,
    @Param('z') zParam: string,
    @Param('x') xParam: string,
    @Param('y') yParam: string,
    @Res() res: Response,
  ) {
    const [yToken, requestedExt] = yParam.split('.', 2);
    const z = Number.parseInt(zParam, 10);
    const x = Number.parseInt(xParam, 10);
    const y = Number.parseInt(yToken, 10);
    if ([z, x, y].some((value) => Number.isNaN(value))) {
      throw new BadRequestException('Invalid tile coordinates');
    }

    const tile = await this.assets.findTile(assetId, z, x, y);
    if (!tile) {
      throw new NotFoundException('Tile not found');
    }

    const stream = await this.storage.getObjectStream(tile.storageKey);
    res.setHeader('Content-Type', tile.mimeType);
    if (requestedExt) {
      const filename = tile.storageKey.split('/').pop() ?? `${x}-${y}.${requestedExt}`;
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }
    stream.pipe(res);
  }
}
