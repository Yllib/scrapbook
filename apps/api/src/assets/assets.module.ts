import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { TilesController } from './tiles.controller';

@Module({
  imports: [StorageModule],
  providers: [AssetsService],
  controllers: [AssetsController, TilesController],
  exports: [AssetsService],
})
export class AssetsModule {}
