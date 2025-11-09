import {
  BadRequestException,
  Body,
  Controller,
  Get,
  FileTypeValidator,
  NotFoundException,
  Param,
  ParseFilePipe,
  MaxFileSizeValidator,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { AssetFormat } from '@prisma/client';

type UploadedFile = {
  mimetype: string;
  originalname?: string;
  path?: string;
  buffer?: Buffer;
} & Record<string, unknown>;
import { AssetsService } from './assets.service';
import { StorageService } from '../storage/storage.service';

interface CreateAssetBody {
  projectId?: string;
}

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly storage: StorageService,
  ) {}
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async uploadAsset(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new FileTypeValidator({ fileType: /^image\// }),
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
        ],
      }),
    )
    file: UploadedFile,
    @Body() body: CreateAssetBody,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file payload');
    }

    const rawProjectId =
      typeof body?.projectId === 'string' ? body.projectId.trim() : undefined;
    const projectId =
      rawProjectId && rawProjectId.length > 0 ? rawProjectId : undefined;

    const { mimetype, originalname, path } = file;
    const buffer =
      file.buffer ?? (path ? await fs.readFile(path) : Buffer.alloc(0));

    if (path) {
      void fs.unlink(path).catch(() => undefined);
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const key = this.storage.generateKey('originals', originalname ?? 'image');
    const stored = await this.storage.putObject({
      key,
      contentType: mimetype,
      body: buffer,
    });

    const metadata = await sharp(buffer).metadata();

    const asset = await this.assets.createAsset({
      projectId,
      filename: originalname ?? 'image',
      mimeType: mimetype,
      size: stored.size,
      checksum: hash,
      width: metadata.width ?? undefined,
      height: metadata.height ?? undefined,
      storageKey: stored.key,
    });

    await this.assets.enqueueOperation({
      assetId: asset.id,
      projectId,
      type: 'asset.process',
      payload: {
        storageKey: stored.key,
        mimeType: mimetype,
      },
    });

    return {
      assetId: asset.id,
      status: asset.status,
    };
  }

  @Get(':id/meta')
  async getAssetMeta(@Param('id') id: string) {
    const asset = await this.assets.findAssetById(id);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  @Get(':id/variant/:format')
  async getAssetVariant(
    @Param('id') id: string,
    @Param('format') formatParam: string,
    @Res() res: Response,
  ) {
    const asset = await this.assets.findAssetById(id);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const [formatToken, requestedExt] = formatParam.split('.', 2);
    const formatKey = formatToken.toUpperCase() as keyof typeof AssetFormat;
    const format = AssetFormat[formatKey];
    if (!format) {
      throw new BadRequestException('Unsupported variant format');
    }

    const variant = await this.assets.findVariantByFormat(id, format);
    if (!variant) {
      throw new NotFoundException('Variant not available');
    }

    const stream = await this.storage.getObjectStream(variant.storageKey);
    res.setHeader('Content-Type', variant.mimeType);
    if (requestedExt) {
      const filename = variant.storageKey.split('/').pop() ?? `asset.${requestedExt}`;
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }
    stream.pipe(res);
  }
}
