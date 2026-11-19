import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = new URL(process.env.REDIS_URL!);
    super(process.env.REDIS_URL!, {
      tls: url.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit() {
    const pong = await this.ping();
    if (pong !== 'PONG') throw new Error('Redis connection failed');
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
