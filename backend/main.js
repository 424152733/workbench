import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkbenchModule } from './app.module.js';
import { WorkbenchService } from './workbench.service.js';
import { LOCAL_API_HOST, localCorsOrigin } from './http-security.js';

const port = Number(process.env.API_PORT || 3001);
const app = await NestFactory.create(WorkbenchModule,{ logger: ['error','warn','log'] });
app.enableCors({
  origin: localCorsOrigin,
  credentials: false,
});
app.useBodyParser('json',{ limit: '3mb' });
app.enableShutdownHooks();
await app.listen(port,LOCAL_API_HOST);
console.log(`保险工作台 API 已启动：http://127.0.0.1:${port}/api/health`);

const service = app.get(WorkbenchService);
const timer = setInterval(() => service.runDueSchedule(),60_000);
timer.unref();

