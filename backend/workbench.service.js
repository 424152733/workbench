import { Injectable } from '@nestjs/common';
import { CustomerFollowupOperations } from './customer-followup-operations.js';
import { ContentOperations } from './content-operations.js';
import { PublicationOperations } from './publication-operations.js';
import { SettingsAssetsOperations } from './settings-assets-operations.js';
import { PolicyServiceOperations } from './policy-service-operations.js';
import { ProductCenterOperations } from './product-center-operations.js';
import { FamilyCoverageOperations } from './family-coverage-operations.js';
import { CustomerAnalyticsOperations } from './customer-analytics-operations.js';
export { cleanGeneratedCopy } from './content-generation-helpers.js';

export class WorkbenchService {
  constructor(db) {
    this.db = db;
    this.scheduleBusy = false;
  }

  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', database: 'connected', ai: process.env.RUNWARE_API_KEY ? 'configured' : 'demo' };
  }
}

// Domain methods share one facade instance so they can keep using `this.db`
// and call sibling operations without changing the controller-facing API.
for (const domain of [CustomerFollowupOperations, CustomerAnalyticsOperations, PolicyServiceOperations, ContentOperations, PublicationOperations, SettingsAssetsOperations, ProductCenterOperations, FamilyCoverageOperations]) {
  const descriptors = Object.getOwnPropertyDescriptors(domain.prototype);
  delete descriptors.constructor;
  Object.defineProperties(WorkbenchService.prototype, descriptors);
}

Injectable()(WorkbenchService);
