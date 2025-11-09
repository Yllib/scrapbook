import { Injectable } from '@nestjs/common';
import {
  AssetFormat,
  AssetStatus,
  Operation,
  OperationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAssetParams {
  projectId?: string | null;
  filename: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageKey: string;
  width?: number;
  height?: number;
}

export interface RecordVariantParams {
  assetId: string;
  format: AssetFormat;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  storageKey: string;
}

export interface RecordTileParams {
  assetId: string;
  z: number;
  x: number;
  y: number;
  size: number;
  mimeType: string;
  storageKey: string;
}

export interface EnqueueOperationParams {
  assetId: string;
  projectId?: string | null;
  type: string;
  payload: Prisma.JsonObject;
}

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAsset(params: CreateAssetParams) {
    const {
      projectId,
      filename,
      mimeType,
      size,
      checksum,
      storageKey,
      width,
      height,
    } = params;

    const normalizedProjectId =
      projectId && projectId.trim().length > 0 ? projectId.trim() : null;

    if (normalizedProjectId) {
      await this.ensureProject(normalizedProjectId);
    }

    return this.prisma.asset.create({
      data: {
        projectId: normalizedProjectId,
        filename,
        mimeType,
        size,
        checksum,
        storageKey,
        width,
        height,
        status: AssetStatus.PENDING,
      },
    });
  }

  updateAssetStatus(
    assetId: string,
    status: AssetStatus,
    failureReason?: string | null,
  ) {
    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        status,
        failureReason: failureReason ?? null,
      },
    });
  }

  recordVariant(params: RecordVariantParams) {
    return this.prisma.assetVariant.create({ data: params });
  }

  recordTile(params: RecordTileParams) {
    return this.prisma.assetTile.create({ data: params });
  }

  enqueueOperation(params: EnqueueOperationParams) {
    const { assetId, projectId, type, payload } = params;
    return this.prisma.operation.create({
      data: {
        assetId,
        projectId: projectId ?? null,
        type,
        payload,
        status: OperationStatus.PENDING,
      },
    });
  }

  markOperation(
    operationId: string,
    status: OperationStatus,
    error?: string | null,
  ) {
    return this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status,
        error: error ?? null,
        processedAt: status === OperationStatus.PENDING ? null : new Date(),
      },
    });
  }

  async claimNextOperation(type: string): Promise<Operation | null> {
    return this.prisma.$transaction(async (tx) => {
      const op = await tx.operation.findFirst({
        where: { type, status: OperationStatus.PENDING },
        orderBy: { createdAt: 'asc' },
      });
      if (!op) return null;
      return tx.operation.update({
        where: { id: op.id },
        data: {
          status: OperationStatus.PROCESSING,
        },
      });
    });
  }

  findAssetById(assetId: string) {
    return this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        variants: true,
        tiles: true,
      },
    });
  }

  listProjectAssets(projectId: string) {
    return this.prisma.asset.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        variants: true,
      },
    });
  }

  findTile(assetId: string, z: number, x: number, y: number) {
    return this.prisma.assetTile.findUnique({
      where: {
        assetId_z_x_y: {
          assetId,
          z,
          x,
          y,
        },
      },
    });
  }

  findVariantByFormat(assetId: string, format: AssetFormat) {
    return this.prisma.assetVariant.findFirst({
      where: { assetId, format },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureProject(projectId: string) {
    await this.prisma.project.upsert({
      where: { id: projectId },
      update: {},
      create: {
        id: projectId,
        name: projectId,
      },
    });
  }
}
