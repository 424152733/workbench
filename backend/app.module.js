import { Inject, Module } from '@nestjs/common';
import { ApiController } from './api.controller.js';
import { DatabaseService } from './database.service.js';
import { WorkbenchService } from './workbench.service.js';

Inject(DatabaseService)(WorkbenchService,undefined,0);

export class WorkbenchModule {}
Module({ controllers: [ApiController], providers: [DatabaseService,WorkbenchService] })(WorkbenchModule);
