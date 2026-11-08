import { Injectable } from '@nestjs/common';
import { CustomerFollowupOperations } from './customer-followup-operations.js';
import { ContentOperations } from './content-operations.js';
import { PublicationOperations } from './publication-operations.js';
import { SettingsAssetsOperations } from './settings-assets-operations.js';
import { PolicyServiceOperations } from './policy-service-operations.js';
import { ProductCenterOperations } from './product-center-operations.js';
import { ProductSyncOperations } from './product-sync-operations.js';
import { FamilyCoverageOperations } from './family-coverage-operations.js';
import { CustomerAnalyticsOperations } from './customer-analytics-operations.js';
import { WorkCalendarOperations } from './work-calendar-operations.js';
import { PolicyContractOperations } from './policy-contract-operations.js';
import { CustomerCoverageOperations } from './customer-coverage-operations.js';
import { PolicyOrganizerExportOperations } from './policy-organizer-export-operations.js';
import { FamilyPolicyReviewOperations } from './family-policy-review-operations.js';
export { cleanGeneratedCopy } from './content-generation-helpers.js';

export class WorkbenchService {
  constructor(db) {
    this.db = db;
    this.scheduleBusy = false;
  }

  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', database: 'connected', ai: process.env.DEEPSEEK_API_KEY ? 'configured' : 'demo' };
  }
}

// Domain methods share one facade instance so they can keep using `this.db`
// and call sibling operations without changing the controller-facing API.
for (const domain of [CustomerFollowupOperations, CustomerAnalyticsOperations, CustomerCoverageOperations, PolicyOrganizerExportOperations, FamilyPolicyReviewOperations, PolicyServiceOperations, PolicyContractOperations, ContentOperations, PublicationOperations, SettingsAssetsOperations, ProductCenterOperations, ProductSyncOperations, FamilyCoverageOperations, WorkCalendarOperations]) {
  const descriptors = Object.getOwnPropertyDescriptors(domain.prototype);
  delete descriptors.constructor;
  Object.defineProperties(WorkbenchService.prototype, descriptors);
}

Injectable()(WorkbenchService);
