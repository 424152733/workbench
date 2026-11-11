import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractProductDocumentText } from './product-document-parser.js';
import { POLICY_CONTRACT_UPLOAD_DIR } from './policy-contract-operations.js';
import { extractPolicyContractExportFacts } from './policy-contract-export-facts.js';
import { contractResponsibilities } from './policy-organizer-responsibilities.js';
import { countPolicyDiseases } from './policy-disease-counts.js';

// Read-only local evidence. The original PDF is never sent to a model here.
export async function loadPolicyContractLocalEvidence({storageName,fileName,parseStatus}) {
  if (!storageName || parseStatus === 'needs_ocr') return {facts:{},benefits:[],diseaseCounts:{critical:null,light:null}};
  const filePath=path.resolve(POLICY_CONTRACT_UPLOAD_DIR,path.basename(storageName));
  const parsed=await extractProductDocumentText({buffer:await readFile(filePath),fileName});
  const facts=extractPolicyContractExportFacts(parsed.pages);
  return {facts,benefits:contractResponsibilities(parsed.pages,facts),diseaseCounts:countPolicyDiseases(parsed.pages)};
}
